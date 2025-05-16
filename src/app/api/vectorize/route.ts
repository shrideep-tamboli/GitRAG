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
  const payloadSize = Buffer.byteLength(text, 'utf8');
  console.log(`Generating embeddings: payload size = ${payloadSize} bytes`);
  try {
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });

    const typed = response as EmbeddingResponse;
    if (!Array.isArray(typed.embeddings) || typed.embeddings.length === 0) {
      throw new Error('Invalid embedding response: embeddings array missing');
    }
    const values = typed.embeddings[0].values;
    if (!Array.isArray(values)) {
      throw new Error('Invalid embedding response: values not found');
    }
    return values;
  } catch (err: unknown) {
    console.error(`Error generating embeddings for payload (size ${payloadSize} bytes):`, err);
    throw err;
  }
}

export async function POST(req: Request) {
  const session = driver.session();
  const { userId } = await req.json();

  try {
    const result = await session.run(
      "MATCH (n {userId: $userId}) RETURN n",
      { userId }
    );

    for (const record of result.records) {
      const node = record.get('n');
      if (node.properties.type !== 'File_Url' || !node.properties.url) {
        console.warn(`Skipping node id=${node.identity.toString()}: type=${node.properties.type}, url=${node.properties.url}`);
        continue;
      }

      const fileUrl: string = node.properties.url;
      console.log(`Processing node id=${node.identity.toString()} url=${fileUrl}`);

      let fileContent = '';
      try {
        const res = await fetch(fileUrl);
        if (res.ok) {
          fileContent = await res.text();
        } else {
          console.warn(`Failed to fetch content from ${fileUrl}: status ${res.status}`);
          continue;
        }
      } catch (fetchErr: unknown) {
        console.warn(`Error fetching file from ${fileUrl}:`, fetchErr);
        continue;
      }

      // If content too large, skip or truncate
      const maxBytes = 4 * 1024 * 1024; // 4MB limit
      const contentSize = Buffer.byteLength(fileContent, 'utf8');
      if (contentSize > maxBytes) {
        console.error(`Skipping ${fileUrl}: content size ${contentSize} bytes exceeds limit ${maxBytes} bytes`);
        continue;
      }

      try {
        const contentEmbedding = await generateEmbeddings(fileContent);
        const codeSummaryText = node.properties.codeSummary || '';
        const summaryEmbedding = await generateEmbeddings(codeSummaryText);

        await session.run(
          `
          MATCH (n)
          WHERE n.url = $url
          SET n.contentEmbedding = $contentEmbedding, n.summaryEmbedding = $summaryEmbedding
          RETURN n
          `,
          { url: fileUrl, contentEmbedding, summaryEmbedding }
        );
        console.log(`Embeddings stored for ${fileUrl}`);
      } catch (embedErr: unknown) {
        console.error(`Error vectorizing ${fileUrl}:`, embedErr);
        // continue with next node
      }
    }

    return NextResponse.json({ message: 'Graph vectorized successfully' }, { status: 200 });
  } catch (error: unknown) {
    console.error('Error during vectorization process:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Error vectorizing graph', details: msg }, { status: 500 });
  } finally {
    await session.close();
  }
}
