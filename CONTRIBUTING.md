# Contributing to GitRag

🎉 Thanks for your interest in contributing to GitRag — Our goal is to provide the user the ability to chat with their repositories. MVP is ready and live. Next goal is to make it more efficient in terms of token usage and time complexity.

We welcome meaningful contributions that improve performance, usability, or reliability. Please read the following guidelines before submitting your pull request.

---

## How to Contribute (non-technical)

- **Create an Issue**: If you find a bug or have an idea for a new feature, please [create an issue](https://github.com/shrideep-tamboli/gitrag/issues/new) on GitHub. This will help us track and prioritize your request.
- **Spread the Word**: If you like GitRag, please share it with your friends, colleagues, and on social media. This will help us grow the community and make GitRag even better.
- **Use GitRag**: The best feedback comes from real-world usage! If you encounter any issues or have ideas for improvement, please let us know by [creating an issue](https://github.com/shrideep-tamboli/gitrag/issues/new) on GitHub or by reaching out to us on [Discord](https://discord.gg/K897HuZjgB).

## How to Contribute (Technical)

Join [Discord](https://discord.gg/K897HuZjgB) 

Hop into the #general channel to contribute on the current technical requirements  

---

## 🛠️ Getting Started 
1. Fork this repo: https://github.com/shrideep-tamboli/GitRAG
2. Clone the forked repo <br>
```bash
git clone https://github.com/your-user-name/gitrag.git
cd gitrag
```
3. Install dependencies
`npm install` <br>
4. Create a new branch for your changes
```bash
git checkout -b your-branch
```
5. Make your changes. Make sure to add corresponding tests for your changes.
6. Test your changes to see if it is working expectedly in the local server
```bash
npm run dev
``` 
8. Build in local before commiting your changes to git <br>
```bash
npm run build
```
9. Iterate over steps 7 and 8 until all checks are met.
10. Commit your changes
```bash
git commit -m "Your commit message"
```
11. Push your changes
```bash
git push origin your-branch
```
12. Open a pull request on GitHub. Make sure to include a detailed description of your changes.
13. Wait for the maintainers to review your pull request. If there are any issues, fix them and repeat steps 5 to 12. <br>
<i>(Optional) Invite project maintainer to your branch for easier collaboration. </i>

---

## 📦 Tech Stack

To help you navigate the project:

- **Frontend**: Next.js, Tailwind CSS, Shadcn UI, Framer Motion
- **Backend**: Node.js, Neo4j (via Bolt), Hugging Face APIs for embeddings, LLM from Gemini 
- **Graph**: Nodes and relationships represent files, summaries, types, and vectors
