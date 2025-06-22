"use client"

import { createClient } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import Box from '@/components/ui/box'
import Text from '@/components/ui/text'
import Lab from './lab'

export default function ResearchPage() {
    const [isAuthorized, setIsAuthorized] = useState(false)

    useEffect(() => {
        const supabase = createClient()
        
        // Fetch the user asynchronously
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()

            // Check if the user's email matches 'dragonslayer'
            if (user && user.email === process.env.NEXT_PUBLIC_DRAGON_SLAYER_EMAIL) {
                setIsAuthorized(true)
            }
        }

        fetchUser()
    }, [])

    if (!isAuthorized) {
        return (
            <Box style={{ textAlign: 'center', padding: '2rem', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
                <Text variant="h4">Coming Soon</Text>
                <Text variant="body1">Stay tuned for updates!</Text>
            </Box>
        )
    }

    return (
            <Lab />
    )
}