"use client"
import HomeSection from "@/components/sections/HomeSection"
import ConnectRepoSection from "@/components/sections/ConnectRepoSection"
import RepoStructureSection from "@/components/sections/RepoStructureSection"
import { useAuth } from '@/lib/AuthContext'

export default function Home() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <main className="flex flex-col">
      <HomeSection />
      {user && (
        <>
          <ConnectRepoSection />
          <RepoStructureSection />
        </>
      )}
    </main>
  )
}

