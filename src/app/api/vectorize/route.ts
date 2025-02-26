// app/api/vectorize/route.ts
import { NextResponse } from "next/server";
import { HfInference } from '@huggingface/inference';
import neo4j from "neo4j-driver";

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY!);
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
      const response = await hf.featureExtraction({
        model: 'sentence-transformers/all-MiniLM-L6-v2',
        inputs: text,
      });
      return response as number[];
    } catch (error) {
      console.error('Error generating embeddings:', error);
      throw error;
    }
  }

export async function POST() {
  const session = driver.session();
  try {
    // Get all nodes from the graph
    const result = await session.run("MATCH (n) RETURN n");
    for (const record of result.records) {
      const node = record.get("n");
      // Process only file-type nodes with a valid URL
      if (node.properties.type !== "File_Url" || !node.properties.url) {
        console.warn(`Skipping node because it's not a valid file type or URL is missing.`);
        continue;
      }
      
      const fileUrl = node.properties.url;
      
      // Fetch file content from the URL
      let fileContent = "";
      try {
        const response = await fetch(fileUrl);
        if (response.ok) {
          fileContent = await response.text();
        } else {
          console.warn(`Failed to fetch file content from ${fileUrl}`);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          console.warn(`Error fetching file content from ${fileUrl}:`, err.message);
        } else {
          console.warn(`Error fetching file content from ${fileUrl}:`, err);
        }
      }      
      
      // Generate embeddings:
      // 1. For file content
      const contentEmbedding = await generateEmbeddings(fileContent);
      // 2. For code summary (if available; otherwise use an empty string)
      const codeSummaryText = node.properties.codeSummary || "";
      const summaryEmbedding = await generateEmbeddings(codeSummaryText);
      
      // Log the embeddings to console
      console.log(`Content embedding for node ${fileUrl}:`, contentEmbedding);
      console.log(`Summary embedding for node ${fileUrl}:`, summaryEmbedding);
      
      // Update the node in Neo4j with the new embeddings
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
    if (error instanceof Error) {
      console.error("Error during vectorization:", error.message);
      return NextResponse.json({ error: "Error vectorizing graph", details: error.message }, { status:500 });
    } else {
      console.error("Error during vectorization:", error);
      return NextResponse.json({ error: "Error vectorizing graph", details: "An unknown error occurred" }, { status:500 });
    }
  }
   finally {
    await session.close();
  }
}
