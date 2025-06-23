"use client"

import { useState } from "react"
import ChatComponent from "@/components/sections/ChatComponent"

export default function Lab() {
    // Generate two unique thread IDs that will persist for the session
    const [threadId1] = useState(`thread_${Math.random().toString(36).substr(2, 9)}`)
    const [threadId2] = useState(`thread_${Math.random().toString(36).substr(2, 9)}`)

    return (
        <div className="flex h-screen">
            {/* Left Chat */}
            <div className="w-1/2 border-r border-gray-200">
                <div className="h-full flex flex-col">
                    <div className="p-4 border-b border-gray-200">
                        <h2 className="text-lg font-semibold">Chat 1</h2>
                    </div>
                    <div className="flex-1 overflow-auto">
                        <ChatComponent threadId={threadId1} />
                    </div>
                </div>
            </div>
            
            {/* Right Chat */}
            <div className="w-1/2">
                <div className="h-full flex flex-col">
                    <div className="p-4 border-b border-gray-200">
                        <h2 className="text-lg font-semibold">Chat 2</h2>
                    </div>
                    <div className="flex-1 overflow-auto">
                        <ChatComponent threadId={threadId2} />
                    </div>
                </div>
            </div>
        </div>
    )
}