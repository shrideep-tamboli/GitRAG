"use client";

import React, { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import axios from "axios";
import { useRouter } from "next/navigation";

// Dynamically import the force-graph component
const ForceGraph3D = dynamic(() => import("react-force-graph").then((mod) => mod.ForceGraph3D), {
  ssr: false,
});

interface Node {
  id: string;
  label: string;
  type: string;
  url: string;
}

interface Link {
  source: string;
  target: string;
  relationship: string;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
}

export default function RepoStructure() {
  const router = useRouter();
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);

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

  // Fetch file content when a file node is selected
  const fetchFileContent = async (url: string) => {
    setIsLoadingContent(true);
    try {
      // For GitHub raw content URLs
      if (url.includes("raw.githubusercontent.com")) {
        const response = await axios.get(url);
        setFileContent(response.data);
      } else {
        // For GitHub API URLs, convert to raw content URL
        const rawUrl = url.replace("api.github.com/repos", "raw.githubusercontent.com").replace("/contents/", "/");
        const response = await axios.get(rawUrl);
        setFileContent(response.data);
      }
    } catch (err) {
      console.error("Error fetching file content:", err);
      setFileContent("Failed to load file content. This might be due to file size limitations or access restrictions.");
    } finally {
      setIsLoadingContent(false);
    }
  };

  // Function to print details about the selected node
  const printNodeDetails = (node: Node) => {
    console.log(`Node Details:`);
    console.log(`ID: ${node.id}`);
    console.log(`Label: ${node.label}`);
    console.log(`Type: ${node.type}`);
    console.log(`URL: ${node.url}`);
  };

  // Handle node click
  const handleNodeClick = useCallback(
    async (node: Node) => {
      setSelectedNode(node);
      setIsDialogOpen(true);
      setFileContent(""); // Reset content when opening dialog

      // Print details about the selected node
      printNodeDetails(node);

      if (node.type === "File_Url" && node.id) {
        await fetchFileContent(node.id);
      }
    },
    [fetchFileContent]
  );

  useEffect(() => {
    if (fileContent) {
      console.log("Displayed Content:");//, fileContent
    }
  }, [fileContent]);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="flex-1 container mx-auto p-8">
        <button 
          onClick={() => router.push("/pages/connect-repo")}
          className="mb-4 p-2 bg-blue-500 text-white rounded"
        >
          Back to Connect Repo
        </button>
        <Card className="p-6 mb-8">
          <h1 className="text-3xl font-bold mb-2">Repository Knowledge Graph</h1>
          <p className="text-muted-foreground">
            Explore your repository structure in 3D. Click on nodes to view details.
          </p>
        </Card>

        {loading && (
          <div className="flex items-center justify-center h-[600px]">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}

        {error && <div className="p-4 bg-destructive/10 text-destructive rounded-md">{error}</div>}

        {!loading && !error && (
          <div className="h-[800px] bg-card rounded-lg shadow-xl overflow-hidden relative">
            <ForceGraph3D
              graphData={graphData}
              nodeLabel={(node: any) => node.label}
              nodeColor={(node: any) =>
                selectedNode?.id === node.id
                  ? "#ff0000" // Highlight selected node in red
                  : node.type === "Repo_Url"
                  ? "#003366" // Dark Blue for Root Folder/Dir
                  : node.type === "Dir_Url"
                  ? "#4CAF50" // Medium Green for Folders
                  : node.type === "File_Url"
                  ? "#FF9800" // Orange for Files
                  : "#003366" // Default color for other types
              }
              nodeRelSize={6}
              linkWidth={2}
              linkDirectionalParticles={4}
              linkDirectionalParticleWidth={2}
              linkDirectionalParticleSpeed={0.005}
              backgroundColor="#f8f9fa"
              onNodeClick={(node: any) => handleNodeClick(node)}
              linkColor={() => "#94a3b8"}
            />
            {/* Legend for node colors */}
            <div className="absolute top-4 right-4 bg-white text-black rounded-lg shadow-lg p-4">
              <h3 className="font-semibold">Node Color Legend</h3>
              <div className="flex flex-col mt-2">
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-red-500 rounded-full mr-2"></div>
                  <span>Selected Node</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-blue-800 rounded-full mr-2"></div>
                  <span>Root Folder</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
                  <span>Folder</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-orange-500 rounded-full mr-2"></div>
                  <span>File</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                {selectedNode?.type === "File_Url" && "📄"}
                {selectedNode?.type === "Dir_Url" && "📁"}
                {selectedNode?.type === "Repo_Url" && "📦"}
                {selectedNode?.label}
              </DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="details" className="mt-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="details">Details</TabsTrigger>
                {selectedNode?.type === "File_Url" && <TabsTrigger value="content">Content</TabsTrigger>}
              </TabsList>

              <TabsContent value="details" className="mt-4">
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold mb-1">Type</h3>
                    <p className="text-muted-foreground">
                      {selectedNode?.type === "File_Url" && "File"}
                      {selectedNode?.type === "Dir_Url" && "Directory"}
                      {selectedNode?.type === "Repo_Url" && "Repository"}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Path</h3>
                  </div>
                  {selectedNode?.type === "File_Url" && (
                    <div>
                      <a
                        href={selectedNode.id}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Open in GitHub ↗
                      </a>
                    </div>
                  )}
                </div>
              </TabsContent>

              {selectedNode?.type === "File_Url" && (
                <TabsContent value="content" className="mt-4">
                  {isLoadingContent ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <pre className="bg-muted p-4 rounded-md overflow-x-auto max-h-[500px] overflow-y-auto">
                      <code>{fileContent}</code>
                    </pre>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
