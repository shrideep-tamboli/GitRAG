"use client"
import ConnectRepoSection from "@/components/sections/ConnectRepoSection"
import RepoStructureSection from "@/components/sections/RepoStructureSection"
import { useAuth } from '@/lib/AuthContext'
import { useRepo } from '@/contexts/RepoContext'
import { useState } from 'react'

export default function Home() {
  const { user, loading } = useAuth()
  const [showRepoStructure, setShowRepoStructure] = useState(false)
  useRepo() // Initialize the repo context

  if (loading) {
    return <div>Loading...</div>
  }

  const handleRepoConnected = () => {
    setShowRepoStructure(true)
  }

  return (
    <main className="flex flex-col">
      <ConnectRepoSection 
        onRepoConnected={handleRepoConnected} 
        isLoggedIn={!!user}
      />
      {user && showRepoStructure && <RepoStructureSection />}
    </main>
  )
}

