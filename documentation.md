## 🎯 Vision
GitRag aims to provide the best solution to chat with Github repositories. Currently, there aren't many solutions, and a couple of similar projects found have gaps in the solution. GitRag aims to find the best solution considering token usage and time complexity to setup chat with github repositories.

## 🛠 Implementation strategy
1. Laod the content from github using the repo url
2. Vectorize the loaded content and store it in a vector database.
3. The GitHub repository is ready for conversation.
4. Accept user query and convert it into vector embeddings.
5. Do a vector similarity search and retrieve the most relevant chunks.
6. Augment the most relevant chunks as context and pass it with the query to the LLM
7. Review the response from the LLM relevant to the code in the Github repository.

## 📦 Tech Stack
- **Frontend**: Next.js, Tailwind CSS, Shadcn UI, Framer Motion
- **Backend**: Node.js/Next.js, TypeScript
- **Vector Database**: Neo4J
- **LLM**: Gemini 2.0 Flash
- **Orchestration framework**: Langchain
