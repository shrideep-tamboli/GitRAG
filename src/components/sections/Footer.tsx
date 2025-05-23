import Link from 'next/link'
import { FaGithub, FaDiscord } from 'react-icons/fa'

export function Footer() {
  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-800 py-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Link
                href="https://github.com/shrideep-tamboli/gitrag/issues/new"
                target="_blank"
                className="flex items-center text-sm text-gray-600 hover:text-gray-900"
              >
                <FaGithub className="w-6 h-6 mr-2" />
                Suggest a feature
              </Link>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <span>made with ❤️ by</span>
            <Link
              href="https://x.com/shrix_x"
              target="_blank"
              className="hover:text-gray-900"
            >
              @shrix_x
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Link
                href="https://discord.gg/K897HuZjgB"
                target="_blank"
                className="flex items-center text-gray-600 hover:text-gray-900"
              >
                <FaDiscord className="w-5 h-5 mr-1" />
                Discord
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
} 