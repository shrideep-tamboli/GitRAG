import { NextResponse } from "next/server";
import neo4j from "neo4j-driver";

// Connect to Neo4j
const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
);

// POST request to add repository structure to the knowledge graph
export async function POST(req: Request) {
  const session = driver.session();

  try {
    const { repoUrl, repoStructure } = await req.json();
    console.log('Received Repository Structure:', repoStructure);
    console.log('Received Repo URL:', repoUrl);

    const firstUrl = repoUrl;

    // Empty the graph before adding new data
    await session.run(`MATCH (n) DETACH DELETE n`);

    // Create the main repository node
    await session.run(
      `
        MERGE (repo:Repo {url: $repoUrl, type: "Repo_Url", label: "Repo"})
      `,
      { repoUrl: firstUrl }
    );

    // Helper function to add nodes and relationships to the graph
    const addToGraph = async (item: any) => {
      const pathParts = item.path.split("/");
      const itemName = pathParts[pathParts.length - 1];
      const codeSummary = item.codeSummary || "No summary available"; // Default if missing

      if (pathParts.length === 1) {
        // Root-level items
        if (item.type === "dir") {
          const dirUrl = `${firstUrl}/${item.path}`;
          await session.run(
            `
              MERGE (dir:Dir {url: $dirUrl, type: "Dir_Url", label: $itemName})
              ON CREATE SET dir.codeSummary = $codeSummary
              MERGE (repo)-[:CONTAINS_DIR]->(dir)
            `,
            { dirUrl, itemName, codeSummary }
          );
        } else if (item.type === "file") {
          const fileUrl = item.download_url;
          await session.run(
            `
              MERGE (file:File {url: $fileUrl, type: "File_Url", label: $itemName})
              ON CREATE SET file.codeSummary = $codeSummary
              MERGE (repo)-[:CONTAINS_FILE]->(file)
            `,
            { fileUrl, itemName, codeSummary }
          );
        }
      } else {
        // Items inside directories
        const parentDir = pathParts.slice(0, -1).join("/");
        const parentUrl = `${firstUrl}/${parentDir}`;

        if (item.type === "dir") {
          const dirUrl = `${firstUrl}/${item.path}`;
          await session.run(
            `
              MERGE (dir:Dir {url: $dirUrl, type: "Dir_Url", label: $itemName})
              ON CREATE SET dir.codeSummary = $codeSummary
              MERGE (parent:Dir {url: $parentUrl})
              MERGE (parent)-[:CONTAINS_DIR]->(dir)
            `,
            { dirUrl, parentUrl, itemName, codeSummary }
          );
        } else if (item.type === "file") {
          const fileUrl = item.download_url;
          await session.run(
            `
              MERGE (file:File {url: $fileUrl, type: "File_Url", label: $itemName})
              ON CREATE SET file.codeSummary = $codeSummary
              MERGE (parent:Dir {url: $parentUrl})
              MERGE (parent)-[:CONTAINS_FILE]->(file)
            `,
            { fileUrl, parentUrl, itemName, codeSummary }
          );
        }
      }
    };

    // Process each item in the repo structure
    for (const item of repoStructure) {
      await addToGraph(item);
    }

    return NextResponse.json(
      { message: "Repository structure successfully added to the knowledge graph" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error processing repository structure:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  } finally {
    // Close the session
    await session.close();
  }
}

// GET request to fetch the knowledge graph data
export async function GET() {
  const session = driver.session();

  try {
    // Fetch nodes and relationships from Neo4j
    const result = await session.run(`
      MATCH (n)-[r]->(m)
      RETURN n, r, m
    `);

    // Format data for the frontend graph library
    const nodes: any[] = [];
    const links: any[] = [];
    const nodeSet = new Set();

    result.records.forEach((record) => {
      const startNode = record.get("n").properties;
      const endNode = record.get("m").properties;
      const relationship = record.get("r").type;

      if (!nodeSet.has(startNode.url)) {
        nodes.push({
          id: startNode.url,
          label: startNode.label,
          type: startNode.type,
          codeSummary: startNode.codeSummary || "No summary available", // Include codeSummary
        });
        nodeSet.add(startNode.url);
      }

      if (!nodeSet.has(endNode.url)) {
        nodes.push({
          id: endNode.url,
          label: endNode.label,
          type: endNode.type,
          codeSummary: endNode.codeSummary || "No summary available",
        });
        nodeSet.add(endNode.url);
      }

      links.push({
        source: startNode.url,
        target: endNode.url,
        relationship,
      });
    });

    // Assuming the repoUrl is stored in the nodes with type "Repo"
    const repoNode = nodes.find(node => node.type === "Repo_Url");
    const repoUrl = repoNode ? repoNode.id : null; // Get the repoUrl from the Repo node

    return NextResponse.json({ nodes, links, repoUrl }, { status: 200 });
  } catch (error: any) {
    console.error("Error fetching graph data:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}
