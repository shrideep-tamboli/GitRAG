"use client"
import ConnectRepoSection from "@/components/sections/ConnectRepoSection"
import RepoStructureSection from "@/components/sections/RepoStructureSection"
import { useAuth } from '@/lib/AuthContext'
import { useState } from 'react'

export default function Home() {
  const { user, loading } = useAuth()
  const [showRepoStructure, setShowRepoStructure] = useState(false)

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <main className="flex flex-col">
      {user && (
        <>
          <ConnectRepoSection onRepoConnected={() => setShowRepoStructure(true)} />
          {showRepoStructure && <RepoStructureSection />}
        </>
      )}
    </main>
  )
}

