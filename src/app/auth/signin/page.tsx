import { SignInForm } from '@/components/auth/SignInForm'

export default function SignIn() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full p-6 bg-white rounded-lg shadow-lg border-4 border-orange-300 rounded-xl p-6 shadow-md">
        <h1 className="text-2xl font-bold mb-6 text-center text-black">Sign In</h1>
        <SignInForm />
      </div>
    </div>
  )
} 