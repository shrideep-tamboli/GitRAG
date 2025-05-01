import Link from 'next/link'
import { ProfileDropdown } from './ProfileDropdown'
import { FaGithub } from 'react-icons/fa'

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-800 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left side: Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <span className="text-xl font-bold text-gray-900">
                Git<span className="text-[#FE4A60]">Rag</span>
              </span>
            </Link>
          </div>

          {/* Right side: GitHub + Profile */}
          <div className="flex items-center gap-4 ml-auto">
            <Link 
              href="https://github.com/shrideep-tamboli/GitRAG" 
              target="_blank"
              className="text-gray-600 hover:text-gray-900"
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
