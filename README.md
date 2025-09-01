# GitHub Performance — Immersive Dashboard

An interactive web dashboard that visualizes GitHub user activity and repository insights in a clean, immersive interface.  
Just paste a GitHub profile link (or username) to explore contributions, repo networks, languages, and more — all powered by public GitHub data.

## Features

- Profile lookup — enter a GitHub username or full profile URL
- Real-time metrics — fetches live GitHub data (client-side)
- Immersive visualizations:
  - Contribution heatmap
  - Repository network (force graph)
  - Top repositories
  - Language distribution chart
- Caching support with IndexedDB + SWR
- Advanced options:
  - Web Worker–based heavy metric processing
  - Permalinks via URL hash (`#user=octocat`)
  - Exportable visualizations

## Getting Started

### Prerequisites
- A modern browser (Chrome, Firefox, Edge, Safari).
- A GitHub account (optional, for higher rate limits).

### Run locally
1. Clone this repository:
   ` https://github.com/ryanfront/GitHub-Performance.git
   cd GitHub-Performance `

2. Install dependencies:
` npm install `

3. Start a local server (for example, using VS Code Live Server):

4. Open http://localhost:3000
 in your browser.

## Notes

- This is a client-side demo using GitHub’s public REST API.

## Example Usage

1. Enter a GitHub username (e.g. octocat).
2. View contribution heatmap, repository networks, top languages, and more.
3. Export visuals for sharing.

## LICENSE
This project is licensed under the MIT License. 
