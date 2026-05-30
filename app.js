// State management
let articlePool = [];
let categoryScores = {};
let postsSinceLastLike = 0;
const API_URL = "https://simple.wikipedia.org/w/api.php";

// Helper to clean HTML text
function cleanText(htmlText) {
    return htmlText.replace(/<.*?>/g, '').replace(/\s+/g, ' ').trim();
}

// NEW: Fetch live articles directly from Wikipedia API
async function fetchLiveArticlesFromServer(quantity = 10) {
    // Use a CORS proxy or standard JSONP/Origin params so the browser doesn't block the request
    const url = `${API_URL}?action=query&format=json&list=random&rnnamespace=0&rnlimit=${quantity}&origin=*`;

    try {
        const response = await fetch(url);
        const listData = await response.json();
        const pageIds = listData.query.random.map(item => item.id);

        const detailUrl = `${API_URL}?action=query&format=json&pageids=${pageIds.join('|')}&prop=extracts|categories|pageimages&exintro=true&exchars=300&cllimit=10&piprop=thumbnail&pithumbsize=400&origin=*`;

        const detailResponse = await fetch(detailUrl);
        const detailData = await detailResponse.json();
        const pages = detailData.query.pages;

        let dynamicBatch = [];

        for (let id in pages) {
            let page = pages[id];
            let snippet = cleanText(page.extract || '');

            if (!snippet || snippet.length < 20) continue;

            // Format clean categories
            let categories = [];
            if (page.categories) {
                page.categories.forEach(cat => {
                    let catTitle = cat.title.replace('Category:', '');
                    if (!/articles|wikipedia|pages|births|deaths/i.test(catTitle)) {
                        let cleanCat = catTitle.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase().replace(/ /g, '_');
                        if (cleanCat) categories.push(cleanCat);
                    }
                });
            }
            if (categories.length === 0) categories.push("general_knowledge");

            dynamicBatch.push({
                id: page.pageid,
                title: page.title,
                text: snippet,
                image: page.thumbnail ? page.thumbnail.source : null,
                categories: categories
            });
        }

        return dynamicBatch;
    } catch (error) {
        console.error("Error connecting to live Wikipedia API:", error);
        return [];
    }
}

// Initialize the app with live network data
async function init() {
    console.log("Connecting to live Wiki feed...");
    articlePool = await fetchLiveArticlesFromServer(10);

    // Render the initial posts
    for (let i = 0; i < 3; i++) {
        await renderNextPost();
    }
    setupIntersectionObserver();
}

// Algorithmic Engine (Scores items in current local pool)
function getNextArticleFromPool() {
    if (articlePool.length === 0) return null;

    const roll = Math.random();

    // 18% Exploration Gate (Random pick)
    if (roll < 0.18) {
        const index = Math.floor(Math.random() * articlePool.length);
        return articlePool.splice(index, 1)[0];
    }

    // Score current items based on user likes
    let scored = articlePool.map((art, index) => {
        let score = art.image ? 5 : 0;
        art.categories.forEach(cat => { score += (categoryScores[cat] || 0); });
        return { article: art, poolIndex: index, score: score };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // 42% Exploitation Gate (Highest score choice)
    let targetIndex = scored[0].poolIndex;

    // 40% Weighted Gate
    if (roll >= 0.60) {
        let minScore = Math.min(...scored.map(s => s.score));
        let offset = minScore < 0 ? Math.abs(minScore) + 1 : 0;
        let total = scored.reduce((sum, s) => sum + (s.score + offset), 0);
        let choice = Math.random() * total;
        let currentSum = 0;

        for (let s of scored) {
            currentSum += (s.score + offset);
            if (choice <= currentSum) {
                targetIndex = s.poolIndex;
                break;
            }
        }
    }

    // Remove selected item from pool so it's never repeated
    return articlePool.splice(targetIndex, 1)[0];
}

// Update the local recommendation weight scoring map
function updateScores(categories, points) {
    categories.forEach(cat => {
        categoryScores[cat] = (categoryScores[cat] || 0) + points;
    });
    console.log("Current Taste Algorithm Mapping:", categoryScores);
}

// Display to Feed
async function renderNextPost() {
    // CRITICAL DYNAMIC STEP: If pool is running dry, fetch more background items on the fly
    if (articlePool.length <= 3) {
        console.log("Pool running low! Pre-fetching fresh articles from Wikipedia...");
        let freshBatch = await fetchLiveArticlesFromServer(10);
        articlePool = articlePool.concat(freshBatch);
    }

    const article = getNextArticleFromPool();
    if (!article) return;

    postsSinceLastLike++;

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = article.id;

    let imgTag = article.image ? `<img src="${article.image}" class="post-img" alt="wiki">` : '';

    card.innerHTML = `
    <div class="title">${article.title}</div>
    <div class="text">${article.text}</div>
    ${imgTag}
    <div class="actions">
      <span class="like-btn">❤ Like</span>
    </div>
  `;

    // Interaction wiring
    const likeBtn = card.querySelector('.like-btn');
    likeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        likeBtn.classList.toggle('liked');
        let points = 50 + (4 * postsSinceLastLike);
        updateScores(article.categories, points);
        postsSinceLastLike = 0;
    });

    if (article.image) {
        card.querySelector('.post-img').addEventListener('click', () => {
            updateScores(article.categories, 100);
        });
    }

    document.getElementById('feed').appendChild(card);
}

// Scroll observer
function setupIntersectionObserver() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
                observer.unobserve(entry.target);
                renderNextPost();
            }
        });
    }, { threshold: 0.1 });

    setInterval(() => {
        document.querySelectorAll('.card').forEach(card => observer.observe(card));
    }, 1000);
}

window.onload = init;