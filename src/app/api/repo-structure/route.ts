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
    const { repoUrl, repoStructure, userId } = await req.json();
    console.log('Received Repository Structure:', repoStructure);
    console.log('Received Repo URL:', repoUrl);

    const firstUrl = repoUrl;

    // Delete all nodes and relationships for this user
    await session.run(
      `MATCH (n)
       WHERE n.userId = $userId
       DETACH DELETE n`,
      { userId }
    );

    // Create the main repository node with user ID
    await session.run(
      `
        MERGE (repo:Repo {url: $repoUrl, type: "Repo_Url", label: "Repo", userId: $userId})
      `,
      { repoUrl: firstUrl, userId }
    );

    interface RepoStructureItem {
      path: string;
      type: string;
      download_url?: string;
      codeSummary?: string;
      // add other fields if needed
    }

    // Helper function to add nodes and relationships to the graph
    const addToGraph = async (item: RepoStructureItem) => {
      const pathParts = item.path.split("/");
      const itemName = pathParts[pathParts.length - 1];
      const codeSummary = item.codeSummary || "No summary available";

      if (pathParts.length === 1) {
        // Root-level items
        if (item.type === "dir") {
          const dirUrl = `${firstUrl}/${item.path}`;
          await session.run(
            `
              MERGE (repo:Repo {userId: $userId, url: $repoUrl})
              MERGE (dir:Dir {url: $dirUrl, type: "Dir_Url", label: $itemName, userId: $userId})
              ON CREATE SET dir.codeSummary = $codeSummary
              MERGE (repo)-[:CONTAINS_DIR]->(dir)
            `,
            { dirUrl, itemName, codeSummary, userId, repoUrl: firstUrl }
          );
        } else if (item.type === "file") {
          const fileUrl = item.download_url;
          await session.run(
            `
              MERGE (repo:Repo {userId: $userId, url: $repoUrl})
              MERGE (file:File {url: $fileUrl, type: "File_Url", label: $itemName, userId: $userId})
              ON CREATE SET file.codeSummary = $codeSummary
              MERGE (repo)-[:CONTAINS_FILE]->(file)
            `,
            { fileUrl, itemName, codeSummary, userId, repoUrl: firstUrl }
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
              MERGE (parent:Dir {url: $parentUrl, userId: $userId})
              MERGE (dir:Dir {url: $dirUrl, type: "Dir_Url", label: $itemName, userId: $userId})
              ON CREATE SET dir.codeSummary = $codeSummary
              MERGE (parent)-[:CONTAINS_DIR]->(dir)
            `,
            { dirUrl, parentUrl, itemName, codeSummary, userId }
          );
        } else if (item.type === "file") {
          const fileUrl = item.download_url;
          await session.run(
            `
              MERGE (parent:Dir {url: $parentUrl, userId: $userId})
              MERGE (file:File {url: $fileUrl, type: "File_Url", label: $itemName, userId: $userId})
              ON CREATE SET file.codeSummary = $codeSummary
              MERGE (parent)-[:CONTAINS_FILE]->(file)
            `,
            { fileUrl, parentUrl, itemName, codeSummary, userId }
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
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error processing repository structure:", error.message);
      return NextResponse.json(
        { error: "Internal Server Error", details: error.message },
        { status: 500 }
      );
    } else {
      console.error("Unexpected error processing repository structure:", error);
      return NextResponse.json(
        { error: "Internal Server Error", details: "An unexpected error occurred." },
        { status: 500 }
      );
    }
  }
   finally {
    // Close the session
    await session.close();
  }
}

interface Node {
  id: string;
  label: string;
  type: string;
  codeSummary?: string;
  contentEmbedding?: number[] | null;
  summaryEmbedding?: number[] | null;
}

interface Link {
  source: string;
  target: string;
  relationship: string;
}

interface Neo4jNode {
  properties: {
    url: string;
    label: string;
    type: string;
    codeSummary?: string;
    contentEmbedding?: number[] | null;
    summaryEmbedding?: number[] | null;
  };
}

interface Neo4jRelationship {
  startUrl: string;
  endUrl: string;
  relationship: string;
}

// GET request to fetch the knowledge graph data
export async function GET(req: Request) {
  const session = driver.session();
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      { error: "User ID is required" },
      { status: 400 }
    );
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return NextResponse.json(
      { error: "Invalid user ID format" },
      { status: 422 }
    );
  }

  try {
    console.log(`Fetching graph data for user ID: ${userId}`);
    
    // Modified query to fetch all nodes and relationships with more explicit relationship data
    const result = await session.run(
      `MATCH (n)
       WHERE n.userId = $userId
       WITH COLLECT(n) as nodes
       OPTIONAL MATCH (start)
       WHERE start.userId = $userId
       OPTIONAL MATCH (start)-[r]->(end)
       WHERE end.userId = $userId
       RETURN nodes, COLLECT({startUrl: start.url, relationship: type(r), endUrl: end.url}) as relationships`,
      { userId }
    );
    
    console.log(`Neo4j query result: ${result.records.length} records found`);

    if (result.records.length === 0) {
      return NextResponse.json(
        { error: "No graph data found for this user" },
        { status: 404 }
      );
    }

    const nodes: Node[] = [];
    const links: Link[] = [];
    const nodeMap = new Map<string, Node>();

    if (result.records.length > 0) {
      const record = result.records[0];
      
      // Process all nodes first
      const allNodes = record.get('nodes') as Neo4jNode[];
      console.log('Raw nodes from Neo4j:', allNodes);
      
      if (allNodes && Array.isArray(allNodes)) {
        allNodes.forEach((node: Neo4jNode) => {
          if (node && node.properties) {
            const props = node.properties;
            const nodeObj = {
              id: props.url,
              label: props.label || 'Unknown',
              type: props.type || 'Unknown',
              codeSummary: props.codeSummary || "No summary available",
              contentEmbedding: props.contentEmbedding || null,
              summaryEmbedding: props.summaryEmbedding || null,
            };
            nodes.push(nodeObj);
            nodeMap.set(props.url, nodeObj);
          }
        });
      }

      // Process relationships
      const relationships = record.get('relationships') as Neo4jRelationship[];
      console.log('Raw relationships from Neo4j:', relationships);
      
      if (relationships && Array.isArray(relationships)) {
        relationships.forEach((rel: Neo4jRelationship) => {
          if (rel && rel.startUrl && rel.endUrl) {
            const startNode = nodeMap.get(rel.startUrl);
            const endNode = nodeMap.get(rel.endUrl);
            
            if (startNode && endNode) {
              links.push({
                source: startNode.id,  // Use the ID instead of the full node
                target: endNode.id,    // Use the ID instead of the full node
                relationship: rel.relationship
              });
            } else {
              console.log('Missing node for relationship:', {
                startUrl: rel.startUrl,
                endUrl: rel.endUrl,
                availableNodes: Array.from(nodeMap.keys())
              });
            }
          }
        });
      }
    }

    console.log('Final processed data:', {
      nodeCount: nodes.length,
      linkCount: links.length,
      sampleNode: nodes[0],
      sampleLink: links[0]
    });
    
    return NextResponse.json({ nodes, links }, { status: 200 });
  } catch (error) {
    console.error("Error in repo-structure GET:", error);
    if (error instanceof Error) {
      return NextResponse.json(
        { error: "Internal Server Error", details: error.message },
        { status: 500 }
      );
    } else {
      return NextResponse.json(
        { error: "Internal Server Error", details: "An unexpected error occurred." },
        { status: 500 }
      );
    }
  } finally {
    await session.close();
  }
}
