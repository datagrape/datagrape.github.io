const https = require('https');
const fs = require('fs');
const path = require('path');

const USERNAME = 'datagrape';
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) {
  console.error('❌ GH_TOKEN environment variable is not set.');
  process.exit(1);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `${USERNAME}-portfolio-builder`,
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve({ data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          reject(new Error('Failed to parse GitHub API response'));
        }
      });
    }).on('error', reject);
  });
}

async function fetchAllRepos() {
  let page = 1;
  let allRepos = [];

  while (true) {
    const url = `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner`;
    console.log(`📡 Fetching page ${page}...`);
    const { data, headers } = await fetchJSON(url);

    if (!Array.isArray(data) || data.length === 0) break;
    allRepos = allRepos.concat(data);

    // Check if there are more pages
    const linkHeader = headers['link'] || '';
    if (!linkHeader.includes('rel="next"')) break;
    page++;
  }

  return allRepos;
}

async function fetchUserInfo() {
  const { data } = await fetchJSON(`https://api.github.com/user`);
  return data;
}

async function main() {
  try {
    console.log('🚀 Starting portfolio build...');

    const [repos, user] = await Promise.all([fetchAllRepos(), fetchUserInfo()]);

    console.log(`✅ Fetched ${repos.length} repos (public + private)`);

    // Filter and sort: skip forks with 0 stars, sort by stars then updated
    const filtered = repos
      .filter(r => !r.archived)
      .sort((a, b) => b.stargazers_count - a.stargazers_count || new Date(b.updated_at) - new Date(a.updated_at));

    // Compute stats
    const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
    const totalForks = repos.reduce((s, r) => s + r.forks_count, 0);
    const languages = [...new Set(repos.map(r => r.language).filter(Boolean))];

    // Strip sensitive fields before embedding
    const safeRepos = filtered.map(r => ({
      name: r.name,
      description: r.description,
      html_url: r.html_url,
      language: r.language,
      stargazers_count: r.stargazers_count,
      forks_count: r.forks_count,
      updated_at: r.updated_at,
      fork: r.fork,
      private: r.private,
      topics: r.topics || [],
    }));

    const payload = {
      repos: safeRepos,
      stats: {
        total: repos.length,
        public: repos.filter(r => !r.private).length,
        private: repos.filter(r => r.private).length,
        stars: totalStars,
        forks: totalForks,
        languages: languages.length,
      },
      user: {
        name: user.name || USERNAME,
        bio: user.bio || '',
        avatar_url: user.avatar_url,
        followers: user.followers,
        following: user.following,
      },
      built_at: new Date().toISOString(),
    };

    // Write JSON data file
    const dataPath = path.join(__dirname, '..', 'repo-data.json');
    fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2));
    console.log(`💾 Written repo-data.json (${safeRepos.length} repos)`);

    // Inject into index.html — replace the placeholder
    const htmlPath = path.join(__dirname, '..', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    const injection = `<script id="repo-data" type="application/json">\n${JSON.stringify(payload)}\n</script>`;

    if (html.includes('<!-- REPO_DATA_INJECT -->')) {
      html = html.replace('<!-- REPO_DATA_INJECT -->', injection);
    } else {
      html = html.replace('</head>', `${injection}\n</head>`);
    }

    fs.writeFileSync(htmlPath, html);
    console.log('✅ Injected repo data into index.html');
    console.log(`\n📊 Stats: ${safeRepos.length} repos · ${totalStars} stars · ${languages.length} languages`);

  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}

main();
