import { NextResponse } from "next/server";
import neo4j from "neo4j-driver";

// Connect to Neo4j
const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
);

export async function GET(req: Request) {
  const session = driver.session();
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  try {
    // Fetch the Repo node for specific user
    const result = await session.run(
      `MATCH (r:Repo {userId: $userId})
       RETURN r.url AS repoUrl`,
      { userId }
    );

    const repoUrl = result.records.length > 0 ? result.records[0].get("repoUrl") : null;

    return NextResponse.json({ repoUrl }, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error fetching repo URL:", error.message);
      return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
    } else {
      console.error("Unexpected error fetching repo URL:", error);
      return NextResponse.json({ error: "Internal Server Error", details: "An unexpected error occurred." }, { status: 500 });
    }
  }
   finally {
    await session.close();
  }
}