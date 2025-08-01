import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// Initialize LLM for file selection
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.2,
});

// --- Types ---
interface EmbeddingValue { values: number[] }
interface EmbeddingResponse {
  embeddings: EmbeddingValue[];
  data?: { embeddings: number[][] };
}

interface FileContext {
  filePath: string;
  fileContent: string;
  codeSummary: string;
  score: number;
  url: string;
}

const ai = (() => {
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === "true") {
    return new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    });
  }
  return new GoogleGenAI({
    vertexai: false,
    apiKey: process.env.GEMINI_API_KEY,
  });
})();

async function generateEmbeddings(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: "text-embedding-004",
    contents: text,
  });
  const typed = response as EmbeddingResponse;
  if (typed.embeddings?.[0]?.values) {
    return typed.embeddings[0].values;
  }
  if (typed.data?.embeddings?.[0]) {
    return typed.data.embeddings[0];
  }
  throw new Error("Invalid embedding format");
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RetrievedSource {
  url: string;
  score: number;
  codeSummary: string;
  summaryEmbedding: number[] | null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = body.message as string;
    const summaries = body.summaries as Array<{
      codeSummary: string;
      summaryEmbedding: number[] | null;
      url: string;
    }>;

    // 1) Embed the user query
    const queryEmbedding = await generateEmbeddings(message);

    // 2) Compute similarity scores for all summaries
    const sims = summaries
      .filter((s) => s.summaryEmbedding)
      .map((s) => ({
        ...s,
        score: cosineSimilarity(queryEmbedding, s.summaryEmbedding!),
      }));

    // Sort the results in descending order based on the score
    sims.sort((a, b) => b.score - a.score);

        // Sort by score and take top 3
    const sortedSims = [...sims].sort((a, b) => b.score - a.score).slice(0, 3);

    // Function to fetch file content
    async function fetchFileContent(url: string): Promise<string> {
      try {
        let resp;
        if (url.includes("raw.githubusercontent.com")) {
          resp = await fetch(url);
        } else if (url.includes("api.github.com/repos")) {
          const parts = url.split("/repos/")[1].split("/contents/");
          const rawUrl = `https://raw.githubusercontent.com/${parts[0]}/main/${parts[1]}`;
          resp = await fetch(rawUrl);
        } else {
          resp = await fetch(url);
        }
        return await resp.text();
      } catch (e) {
        console.error(`Error fetching ${url}:`, e);
        return "";
      }
    }

    // Function to determine if a file is needed and sufficient
    async function shouldUseFile(
      file: FileContext,
      query: string,
      previousContext: string
    ): Promise<{ needed: boolean; enough: boolean }> {
      // Create the prompt with proper escaping of curly braces
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", `You are an AI assistant that determines if a file is needed to answer a user's query.
        You will be given:
        1. The user's query
        2. Previous context (if any)
        3. A file's content and metadata

        You must answer two questions:
        1. Is this file needed to answer the query? (yes/no)
        2. Is this file alone enough to fully answer the query? (yes/no)
        
        Respond in JSON format with the following structure:
        {{
          "needed": boolean,
          "enough": boolean,
          "reasoning": string
        }}`],
        ["human", `User query: {query}
        
        Previous context: {previousContext}
        
        File path: {filePath}
        File summary: {fileSummary}
        
        File content (first 2000 chars): {fileContent}`]
      ]);

      // Format the prompt with the actual values
      const formattedPrompt = await prompt.format({
        query,
        previousContext: previousContext || 'None',
        filePath: file.filePath,
        fileSummary: file.codeSummary,
        fileContent: file.fileContent.substring(0, 2000)
      });

      const response = await llm.invoke(formattedPrompt);
      const responseStr = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      // Strip code block backticks if present
      const cleanedJson = responseStr.trim().startsWith("```")
        ? responseStr.replace(/```json|```/g, '').trim()
        : responseStr;

        try {
          const result = JSON.parse(cleanedJson);
        
          console.log(`→ ${file.filePath}`);
          console.log("LLM File Analysis Result:", {
            needed: result.needed,
            enough: result.enough,
            reasoning: result.reasoning
          });
        
          return {
            needed: result.needed !== false,
            enough: result.enough === true
          };
        } catch {
          console.error('Failed to parse LLM response:', responseStr);
          return { needed: true, enough: false };
        }
    }

    // Process files in order of relevance
    const selectedFiles = [];
    for (const sim of sortedSims) {
      if (selectedFiles.length >= 3) break;

      const fileContent = await fetchFileContent(sim.url);
      const fileContext: FileContext = {
        filePath: sim.url.includes("/contents/")
          ? sim.url.split("/contents/")[1]
          : sim.url.split("/main/")[1] || sim.url,
        fileContent,
        codeSummary: sim.codeSummary,
        score: sim.score,
        url: sim.url
      };

      const previousContext = selectedFiles
        .map(f => `File: ${f.url.split('/').pop()}\nSummary: ${f.codeSummary}`)
        .join('\n\n');

      const { needed, enough } = await shouldUseFile(
        fileContext,
        body.message,
        previousContext
      );

      if (needed) {
        selectedFiles.push({
          url: sim.url,
          score: sim.score,
          codeSummary: sim.codeSummary,
          summaryEmbedding: sim.summaryEmbedding
        });

        if (enough || selectedFiles.length >= 3) {
          break; // Stop if enough or limit reached
        }
      }
    }

    // If no files were selected, fall back to the top result
    const finalSources = selectedFiles.length > 0 
      ? selectedFiles 
      : [{
          url: sortedSims[0].url,
          score: sortedSims[0].score,
          codeSummary: sortedSims[0].codeSummary,
          summaryEmbedding: sortedSims[0].summaryEmbedding
        }];

    return NextResponse.json({
      success: true,
      sources: finalSources
    });
  } catch (err) {
    console.error("Retrieve error:", err);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve relevant sources" },
      { status: 500 }
    );
  }
}
