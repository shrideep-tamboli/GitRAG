// app/api/vectorize/route.ts
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import neo4j from "neo4j-driver";

// Define proper types for Google AI embedding responses
interface EmbeddingValue {
  values: number[];
}

interface EmbeddingResponse {
  embeddings: EmbeddingValue[];
}

// Initialize GenAI client (public Gemini API)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  vertexai: false,
});

// Connect to Neo4j
const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password"
  )
);

async function generateEmbeddings(text: string): Promise<number[]> {
  try {
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });

    // Extract the first embedding's values array using proper typing
    const typedResponse = response as EmbeddingResponse;
    if (!Array.isArray(typedResponse.embeddings) || typedResponse.embeddings.length === 0) {
      throw new Error('Invalid embedding response: embeddings array missing');
    }
    
    const values = typedResponse.embeddings[0].values;
    if (!Array.isArray(values)) {
      throw new Error('Invalid embedding response: values not found');
    }
    
    return values;
  } catch (error) {
    console.error("Error generating embeddings with GoogleGenAI:", error);
    throw error;
  }
}

export async function POST(req: Request) {
  const session = driver.session();
  const { userId } = await req.json();  // Add userId parameter

  try {
    // Fetch user-specific nodes
    const result = await session.run(
      "MATCH (n {userId: $userId}) RETURN n",
      { userId }
    );

    for (const record of result.records) {
      const node = record.get("n");
      if (node.properties.type !== "File_Url" || !node.properties.url) {
        console.warn(`Skipping node because it's not a valid file type or URL is missing.`);
        continue;
      }

      const fileUrl = node.properties.url;
      let fileContent = "";
      try {
        const response = await fetch(fileUrl);
        if (response.ok) fileContent = await response.text();
        else console.warn(`Failed to fetch file content from ${fileUrl}`);
      } catch (err: unknown) {
        console.warn(`Error fetching file content from ${fileUrl}:`, err);
      }

      // Generate embeddings
      const contentEmbedding = await generateEmbeddings(fileContent);
      const codeSummaryText = node.properties.codeSummary || "";
      const summaryEmbedding = await generateEmbeddings(codeSummaryText);

      // Update Neo4j node with flat arrays
      await session.run(
        `
        MATCH (n)
        WHERE n.url = $url
        SET n.contentEmbedding = $contentEmbedding, n.summaryEmbedding = $summaryEmbedding
        RETURN n
        `,
        { url: fileUrl, contentEmbedding, summaryEmbedding }
      );
    }

    return NextResponse.json({ message: "Graph vectorized successfully" }, { status: 200 });
  } catch (error: unknown) {
    console.error("Error during vectorization:", error);
    const msg = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: "Error vectorizing graph", details: msg }, { status: 500 });
  } finally {
    await session.close();
  }
}
