import { NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";
import { GoogleGenAI } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY!);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
    // Try direct axios call to debug the issue
    const response = await axios.post(
      'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2',
      { inputs: text },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Raw API Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error("Error generating embeddings:", error);
    if (axios.isAxiosError(error)) {
      console.error("Full error response:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers
      });
    }
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

async function fetchFileContent(url: string): Promise<string | null> {
  try {
    console.log("Fetching content from URL:", url);
    
    let response;
    if (url.includes("raw.githubusercontent.com")) {
      response = await axios.get(url);
    } else if (url.includes("api.github.com/repos")) {
      const parts = url.split('/repos/')[1].split('/contents/');
      const repoPath = parts[0];
      const filePath = parts.length > 1 ? parts[1] : '';
      const rawUrl = `https://raw.githubusercontent.com/${repoPath}/main/${filePath}`;
      
      console.log("Transformed URL:", rawUrl);
      response = await axios.get(rawUrl);
    } else {
      response = await axios.get(url);
    }
    
    console.log("Content fetched successfully");
    return response.data;
  } catch (err) {
    console.error("Error fetching file content:", err);
    if (axios.isAxiosError(err)) {
      return `Failed to load file content: ${err.message}. Status: ${err.response?.status || 'unknown'}`;
    }
    return "Failed to load file content due to unknown error.";
  }
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
    
    // Fetch file content for top results and structure the data
    const structuredResults = await Promise.all(
      topResults.map(async (result) => {
        const fileContent = await fetchFileContent(result.url);
        // Extract relative file path from the URL
        const relativePath = result.url.includes('/repos/') 
          ? result.url.split('/contents/')[1] 
          : result.url.split('/main/')[1] || result.url;

        return {
          filePath: relativePath,
          fileContent: fileContent || "No content available",
          codeSummary: result.codeSummary
        };
      })
    );

    console.log("Structured Results:", JSON.stringify(structuredResults, null, 2));

    // system prompt with structured context
    const systemPrompt = `You are an assistant for question-answering tasks.
                         Use the following structured context to answer the question.
                         Each file in the context contains:
                         - filePath: The relative path of the file
                         - fileContent: The actual code content of the file
                         - codeSummary: A summary of what the code does
                         
                         If you don't know the answer, just say that you don't know.
                         Use three sentences maximum and keep the answer concise.
                         
                         Context: ${JSON.stringify(structuredResults, null, 2)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt }]
        },
        {
          role: "user",
          parts: [{ text: body.message }]
        }
      ]
    });

    if (!response.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error("Failed to generate response");
    }

    const responseText = response.candidates[0].content.parts[0].text;
    console.log("Gemini Response:", responseText);

    // Update Supabase storage with new response format
    const { error: insertError } = await supabase
      .from('chat_data')
      .insert({
        user_query: body.message,
        bot_response: responseText,
        context_urls: topResults.map(result => result.url),
        similarity_scores: topResults.map(result => ({
          url: result.url,
          score: result.score
        }))
      });

    if (insertError) {
      console.error('Error storing chat data:', insertError);
    }

    return NextResponse.json({ 
      success: true, 
      results: similarityResults, 
      response: responseText 
    });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return NextResponse.json(
      { success: false, message: "Error processing request" },
      { status: 500 }
    );
  }
}
