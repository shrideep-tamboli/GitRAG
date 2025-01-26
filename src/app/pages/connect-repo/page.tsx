"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConnectRepo() {
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [contents, setContents] = useState<any[]>([]);
  const router = useRouter();

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
        body: JSON.stringify({ url: repoUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to connect to the repository");
      }

      if (data.message) {
        setError(data.message); // Handle messages like "empty repo"
      } else {
        setContents(data);
        
        // Send data and repoUrl to repo-structure
        await fetch("/api/repo-structure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ repoUrl, repoStructure: data }), // Sending both repoUrl and data
        });

        // Redirect to repo-structure page
        router.push("/pages/repo-structure"); // Redirect to the repo-structure page
      }

      console.log("Repository Structure:", data);
    } catch (err: any) {
      console.error("Error connecting to repository:", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-2xl mb-4">Connect to Git Repository</h1>
      <input
        type="text"
        value={repoUrl}
        onChange={(e) => setRepoUrl(e.target.value)}
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
  );
}
