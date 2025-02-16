"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ConnectRepo() {
  const [repoUrl, setRepoUrl] = useState("");
  const [inputRepoUrl, setInputRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  interface RepoItem {
    name: string;
    path: string;
    type: string;
    download_url: string | null;
    codeSummary?: string | null;
  }
  
  const [contents, setContents] = useState<RepoItem[]>([]);
  
  const router = useRouter();

  // Fetch the connected repository URL when the component mounts
  useEffect(() => {
    const fetchConnectedRepo = async () => {
      try {
        const response = await fetch("/api/get-repo-url");
        if (!response.ok) {
          throw new Error("Failed to fetch connected repository");
        }
        const data = await response.json();
        console.log("Fetched data from get-repo-url:", data);
        if (data.repoUrl) {
          setRepoUrl(data.repoUrl);
        } else {
          console.warn("No repoUrl found in the response.");
        }
      } catch (err) {
        if (err instanceof Error) {
          console.error("Error fetching connected repository:", err.message);
        } else {
          console.error("Unexpected error fetching connected repository:", err);
        }
      }
    };
  
    fetchConnectedRepo();
  }, []);
  

  const handleConnect = async () => {
    setLoading(true);
    setError("");
    setContents([]);
  
    try {
      const response = await fetch("/api/connect-repo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: inputRepoUrl }),
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        throw new Error(data.error || "Failed to connect to the repository");
      }
  
      if (data.message) {
        setError(data.message);
      } else {
        setContents(data);
        setRepoUrl(inputRepoUrl);
        setInputRepoUrl("");
  
        await fetch("/api/repo-structure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            repoUrl: inputRepoUrl,
            repoStructure: data
          }),
        });
  
        router.push("/pages/repo-structure");
      }
  
      console.log("Repository Structure:", data);
      console.log('Received Repository Structure:', data);
      console.log('Received Repo URL:', repoUrl);
    } catch (err) {
      if (err instanceof Error) {
        console.error("Error connecting to repository:", err.message);
        setError(err.message);
      } else {
        console.error("Unexpected error connecting to repository:", err);
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  };
  

  return (
    <div className="flex flex-col md:flex-row min-h-screen p-8">
      <div className="flex-1 flex flex-col items-center justify-center">
        <h1 className="text-2xl mb-4">Connect to Git Repository</h1>
        <input
          type="text"
          value={inputRepoUrl}
          onChange={(e) => setInputRepoUrl(e.target.value)}
          placeholder="Enter Git Repo URL"
          className="border rounded p-2 mb-4 w-full max-w-md text-black"
        />
        <button
          onClick={handleConnect}
          disabled={loading}
          className={`rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center bg-foreground text-background h-10 px-4 ${
            loading ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {loading ? "Connecting..." : "Connect"}
        </button>

        {error && <p className="text-red-500 mt-4">{error}</p>}

        {contents.length > 0 && (
          <div className="mt-8 w-full max-w-2xl">
            <h2 className="text-xl mb-4">Repository Contents</h2>
            <ul className="list-disc list-inside">
              {contents.map((item, index) => (
                <li key={index} className="mb-2">
                  <strong>{item.name}</strong> ({item.type}) - {item.path}
                  {item.download_url && (
                    <a
                      href={item.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-500 ml-2"
                    >
                      View File
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <h2 className="text-xl mb-4">Connected Repository</h2>
        <p className="mb-2">{repoUrl || "No repository connected."}</p>
        <button
          onClick={() => router.push("/pages/repo-structure")}
          className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors bg-blue-500 text-white h-10 px-4"
        >
          View Repository Structure
        </button>
      </div>
    </div>
  );
}
