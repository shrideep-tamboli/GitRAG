[[Notebook]](https://colab.research.google.com/drive/1Ss4u542XUhT8eZ3GmyecGPjyi1pRzHHb?usp=sharing)

### Aim:

This project aims to create a code generator that utilizes LLMs code generation capabilities and takes data references from GitHub. 
[Extended features]
Code implementation agent, error logging and error solving from StackOverflow api.

### Tech stack:

1. Development framework: **Next.js**
2. Knowledge Graph and Vector Database: **Neo4j**
3. LLM orchestration framework: **Langchain**
4. LLM: **DeepSeek**, **CodeLlama**, **Llama 3.1/2/3**, Gpt-4o  
5. Embeddings Model: 
Free: **Snowflake Arctic-Embed 2.0** *(best)***, CodeBERT** *(best-coder)* 
Paid: **OpenAI text-embedding-3-large, OpenAI's code-search-babbage-{code, text}-001

### Methodology:

1. Prompt Input
2. Keyword extraction from prompts
3. Top-k repositories are extracted based on the search results of keywords.
4. Knowledge Graph schema is populated with the relevant data. *(refer structure below)*
5. Each code file has a summary. Only those nodes are retrieved whose summaries are semantically similar to the user prompt. Additionally the nodes dependent on other nodes are also augmented for context. (this means we’ll need 2 KGs for repo structure and dependency structure.
6. Retrieved data is with LLM for code generation.
7. GitRAG Chatbot can used for code generation or QnA.

Additional:

1. Automatic Implementation of generated code.
2. Discriminator to evaluate the code output 
3. Errors can be queried to a StackOverflow-augmented chatbot.
4. Code changes and iteration.

### Knowledge Graph Structure:

Nodes: 

1. Repo metadata (URL, Name, ID)
2. Folder Name
3. File Name

Relationship:

1. Contains_Folder: Repo metadata → Folder Name
2. Contains_Files: Folder Name → File Name

### Literature Review:

1. Github Searching Methods especially [search syntax](https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax)
