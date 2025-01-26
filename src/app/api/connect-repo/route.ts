import { NextResponse } from 'next/server';
import axios from 'axios';

const blacklistedKeywords = ['LICENSE', 'git', 'docker', 'Makefile'];
const blacklistedDirKeywords = [
  '.git',
  '.github',
  'docs',
  'tests',
  'example',
  'images',
  'docker',
  'sdks',
  'dev',
  'events',
  'extensions',
  'deployment',
];

// Helper function to check if an item is blacklisted
const isBlacklisted = (itemName: string, itemPath: string): boolean => {
  if (itemName.startsWith('.')) return true;

  for (const keyword of blacklistedKeywords) {
    if (itemName.toLowerCase().includes(keyword.toLowerCase())) return true;
  }

  for (const keyword of blacklistedDirKeywords) {
    if (itemPath.toLowerCase().includes(keyword.toLowerCase())) return true;
  }

  return false; // Ensure a boolean value is always returned
};

// Recursive function to fetch repository contents
const fetchRepositoryContents = async (
  repoUrl: string,
  token: string,
  path = ''
): Promise<any[]> => {
  const repoItems: any[] = [];

  try {
    const parts = repoUrl.replace(/\/$/, '').split('/');
    const owner = parts[parts.length - 2];
    const repoName = parts[parts.length - 1];
    const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${path}`;

    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (response.status === 200) {
      const contents = response.data;

      for (const item of contents) {
        if (isBlacklisted(item.name, item.path)) {
          continue;
        }

        repoItems.push({
          name: item.name,
          path: item.path,
          type: item.type,
          download_url: item.download_url || null,
        });

        if (item.type === 'dir') {
          const subdirContents = await fetchRepositoryContents(
            repoUrl,
            token,
            item.path
          );
          repoItems.push(...subdirContents);
        }
      }
    }
  } catch (error: any) {
    console.error(`Error fetching repository contents: ${error.message}`);
    throw new Error(
      `Failed to fetch repository contents: ${error.response?.data?.message || error.message}`
    );
  }

  return repoItems;
};

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    const token = process.env.git_api_key;

    if (!url || !token) {
      return NextResponse.json({ error: 'Missing required parameters: url or token' }, { status: 400 });
    }

    const contents = await fetchRepositoryContents(url, token);

    if (!contents || contents.length === 0) {
      return NextResponse.json({ message: 'Repository is empty or no non-blacklisted items found' }, { status: 200 });
    }

    console.log('Repo_Structure:', contents);
    return NextResponse.json(contents);
  } catch (error: any) {
    console.error('Error processing request:', error.message);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
