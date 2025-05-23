// app/api/connect-repo/progress/route.ts
import { NextResponse } from "next/server";

// In-memory storage for progress tracking
// In a production environment, consider using Redis or another shared state solution
import { progressStore } from "./utils";


export async function GET(req: Request) {
  // Extract userId from query parameters
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  // Set up Server-Sent Events
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial data
      const initialData = progressStore[userId] || {
        userId,
        totalFiles: 0,
        processedFiles: 0,
        currentFile: "",
        lastUpdate: Date.now(),
      };
      const message = `data: ${JSON.stringify(initialData)}\n\n`;
      controller.enqueue(encoder.encode(message));

      // Set up interval to send progress updates
      const intervalId = setInterval(() => {
        const data = progressStore[userId] || initialData;
        
        // Check if there's been an update in the last 10 seconds
        const isStale = Date.now() - data.lastUpdate > 10000;
        
        // If processing is complete or data is stale, clean up and close
        if (isStale || (data.totalFiles > 0 && data.processedFiles >= data.totalFiles)) {
          clearInterval(intervalId);
          controller.close();
          return;
        }
        
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      }, 500); // Send updates every 500ms

      // Cleanup function
      return () => {
        clearInterval(intervalId);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
