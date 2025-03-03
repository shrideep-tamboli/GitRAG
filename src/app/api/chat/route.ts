import { NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";
import Groq from "groq-sdk";
import { createClient } from '@supabase/supabase-js';

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY!);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Summary {
  codeSummary: string;
  summaryEmbedding: number[] | null;
  url: string;
}

async function generateEmbeddings(text: string): Promise<number[]> {
  try {
    const response = await hf.featureExtraction({
      model: "sentence-transformers/all-MiniLM-L6-v2",
      inputs: text,
    });
    return response as number[];
  } catch (error) {
    console.error("Error generating embeddings:", error);
    throw error;
  }
}

// Helper function to compute cosine similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] ** 2;
    normB += vecB[i] ** 2;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Generate the embedding for the input query
    const message_embedding = await generateEmbeddings(body.message);
    console.log("Query Embedding Dimension", message_embedding.length);

    // Retrieve the summaries from the request body
    const summaries: Summary[] = body.summaries;
    console.log("User Query:", body.message);

    // Log the list of URLs from the summaries
    const urls = summaries.map((summary) => summary.url);
    console.log("Number of items in the List of URLs:", urls.length);

    // Compute cosine similarity for each summary (if embedding exists)
    const similarityResults = summaries
      .filter(summary => summary.summaryEmbedding !== null)
      .map(summary => {
        const score = cosineSimilarity(message_embedding, summary.summaryEmbedding!);
        return { score, url: summary.url, codeSummary: summary.codeSummary };
      });

    // Sort the results in descending order based on the similarity score
    similarityResults.sort((a, b) => b.score - a.score);

    // Get the top 5 results
    const topResults = similarityResults.slice(0, 5);
    console.log("Top 5 Results:", topResults);

    // Format the context to include code summaries
    const contextStr = topResults
      .map(result => `[${result.url}]: ${result.codeSummary}`)
      .join('\n');

    // system prompt
    const systemPrompt = `You are an assistant for question-answering tasks.
                          Use the following pieces of retrieved context to answer the question.
                          If you don't know the answer, just say that you don't know.
                          Use three sentences maximum and keep the answer concise.
                          Context: ${contextStr}`;

    const response = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: body.message,
        },
      ],
      model: "deepseek-r1-distill-qwen-32b",
    });

    console.log("Groq Response:", response.choices[0].message.content);

    // Store chat data in Supabase
    const { error: insertError } = await supabase
      .from('chat_data')
      .insert({
        user_query: body.message,
        bot_response: response.choices[0].message.content,
        context_urls: topResults.map(result => result.url),
        similarity_scores: topResults.map(result => ({
          url: result.url,
          score: result.score
        }))
      });

    if (insertError) {
      console.error('Error storing chat data:', insertError);
    }

    return NextResponse.json({ success: true, results: similarityResults, response: response.choices[0].message.content });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return NextResponse.json(
      { success: false, message: "Error processing request" },
      { status: 500 }
    );
  }
}
