"use client"
import Link from 'next/link'
import { ProfileDropdown } from '../ProfileDropdown'
import { FaGithub } from 'react-icons/fa'
import { FlaskConical, FolderTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRepo } from '@/contexts/RepoContext'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import KnowledgeGraph from '@/components/sections/KnowledgeGraph'

export function Header() {
  const { isRepoConnected } = useRepo()
  return (
    <header className="fixed top-0 left-0 right-0 bg-surface border-b border-border z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left side: Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <span className="text-xl font-bold text-foreground">
                Git<span className="text-accent">Rag</span>
              </span>
            </Link>
          </div>

          {/* Right side: GitHub + Profile */}
          <div className="flex items-center gap-4 ml-auto">
            <Link 
              href="/research" 
              className={cn(
                "text-muted hover:text-foreground transition-colors",
                !isRepoConnected && "opacity-50 cursor-not-allowed"
              )}
              aria-disabled={!isRepoConnected}
              onClick={(e) => !isRepoConnected && e.preventDefault()}
              title={!isRepoConnected ? "Connect a repository to access research" : "Research"}
            >
              <FlaskConical className="w-6 h-6" />
            </Link>

            <Dialog>
              <DialogTrigger asChild>
                <button
                  className={cn(
                    "text-muted hover:text-foreground transition-colors",
                    !isRepoConnected && "opacity-50 cursor-not-allowed"
                  )}
                  aria-disabled={!isRepoConnected}
                  onClick={(e) => {
                    if (!isRepoConnected) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  title={!isRepoConnected ? "Connect a repository to view structure" : "Repository Structure"}
                >
                  <FolderTree className="w-6 h-6" />
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-4 overflow-hidden">
                <KnowledgeGraph />
              </DialogContent>
            </Dialog>

            <Link 
              href="https://github.com/shrideep-tamboli/GitRAG" 
              target="_blank"
              className="text-muted hover:text-foreground"
            >
              <FaGithub className="w-6 h-6" />
            </Link>

            {/* Spacer to push profile image far right */}
            <div className="flex-1" />

            {/* Profile aligned to far right */}
            <ProfileDropdown />
          </div>
        </div>
      </div>
    </header>
  )
}
