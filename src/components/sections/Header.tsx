import Link from 'next/link'
import { ProfileDropdown } from '../ProfileDropdown'
import { FaGithub } from 'react-icons/fa'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button' // Assuming Button component is available
import { useState, useEffect } from 'react'

export function Header() {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  return (
    <header className="fixed top-0 left-0 right-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left side: Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Git<span className="text-[#F6A55f]">Rag</span>
              </span>
            </Link>
          </div>

          {/* Right side: GitHub + Theme Toggle + Profile */}
          <div className="flex items-center gap-4 ml-auto">
            <Link
              href="https://github.com/shrideep-tamboli/GitRAG"
              target="_blank"
              className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <FaGithub className="w-6 h-6" />
            </Link>

            {/* Theme Toggle Button */}
            {mounted ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle theme"
                className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              >
                {resolvedTheme === 'dark' ? (
                  <Sun className="w-5 h-5" />
                ) : (
                  <Moon className="w-5 h-5" />
                )}
              </Button>
            ) : (
              <div className="w-9 h-9" /> // Placeholder for the button to prevent layout shift
            )}
            
            {/* Spacer to push profile image far right - REMOVED as gap-4 on parent should handle spacing */}
            {/* Profile aligned to far right */}
            <ProfileDropdown />
          </div>
        </div>
      </div>
    </header>
  )
}
