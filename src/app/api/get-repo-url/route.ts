import { NextResponse } from "next/server";
import neo4j from "neo4j-driver";

// Connect to Neo4j
const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
);

export async function GET() {
  const session = driver.session();

  try {
    // Fetch the Repo node
    const result = await session.run(`
      MATCH (r:Repo)
      RETURN r.url AS repoUrl
    `);

    const repoUrl = result.records.length > 0 ? result.records[0].get("repoUrl") : null;

    return NextResponse.json({ repoUrl }, { status: 200 });
  } catch (error: any) {
    console.error("Error fetching repo URL:", error.message);
    return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
  } finally {
    await session.close();
  }
}