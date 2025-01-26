"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// Dynamically import the force-graph component to work in Next.js
const ForceGraph3D = dynamic(() => import("react-force-graph").then((mod) => mod.ForceGraph3D), {
  ssr: false,
});

export default function RepoStructure() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch the knowledge graph data from the backend
  useEffect(() => {
    const fetchGraphData = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/repo-structure");

        if (!response.ok) {
          throw new Error(`Failed to fetch graph data: ${response.statusText}`);
        }

        const data = await response.json();
        setGraphData(data);
      } catch (err: any) {
        console.error("Error fetching graph data:", err.message);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchGraphData();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-2xl mb-4">Repository Knowledge Graph</h1>

      {loading && <p>Loading graph...</p>}
      {error && <p className="text-red-500">{error}</p>}

      {!loading && !error && (
        <div style={{ width: "100%", height: "600px" }}>
          <ForceGraph3D
            graphData={graphData}
            nodeLabel={(node: any) => `${node.label} (${node.type})`}
            linkLabel={(link: any) => link.relationship}
            nodeAutoColorBy="type"
            linkDirectionalParticles={4}
            linkDirectionalParticleSpeed={0.005}
          />
        </div>
      )}
    </div>
  );
}
