/**
 * WikiScroll - Core Application Script
 * Features: Live API Integration, Local Recommendation Engine, Infinite Scroll
 */

// State management
let articlePool = [];
let categoryScores = {};
let postsSinceLastLike = 0;
const API_URL = "https://simple.wikipedia.org/w/api.php";

// Helper function to strip HTML tags and sanitize whitespace
function cleanText(htmlText) {
    return htmlText.replace(/<.*?>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Pipeline Step: Fetches fresh, random content directly from Simple Wikipedia.
 * Uses 'origin=*' to bypass browser CORS security restrictions dynamically.
 */
async function fetchLiveArticlesFromServer(quantity = 10) {
    const url = `${API_URL}?action=query&format=json&list=random&rnnamespace=0&rnlimit=${quantity}&origin=*`;

    try {
        const response = await fetch(url);
        const listData = await response.json();
        const pageIds = listData.query.random.map(item => item.id);

        // Fetch deep metadata (intro extracts, category tags, images) for the page IDs
        const detailUrl = `${API_URL}?action=query&format=json&pageids=${pageIds.join('|')}&prop=extracts|categories|pageimages&exintro=true&exchars=300&cllimit=10&piprop=thumbnail&pithumbsize=400&origin=*`;

        const detailResponse = await fetch(detailUrl);
        const detailData = await detailResponse.json();
        const pages = detailData.query.pages;

        let dynamicBatch = [];

        for (let id in pages) {
            let page = pages[id];
            let snippet = cleanText(page.extract || '');

            // Skip thin stub stubs or empty descriptions
            if (!snippet || snippet.length < 20) continue;

            // Extract and sanitize category strings into clean database keys
            let categories = [];
            if (page.categories) {
                page.categories.forEach(cat => {
                    let catTitle = cat.title.replace('Category:', '');
                    // Filter out internal administrative Wikipedia tracking categories
                    if (!/articles|wikipedia|pages|births|deaths/i.test(catTitle)) {
                        let cleanCat = catTitle.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase().replace(/ /g, '_');
                        if (cleanCat) categories.push(cleanCat);
                    }
                });
            }

            // Fallback hook if no categories survived the filter
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
        console.error("Network Exception connecting to Wikipedia API:", error);
        return [];
    }
}

/**
 * The Feed Recommendation Engine
 * Splits probabilities: 18% Exploration (Random), 42% Best Score, 40% Roulette Weight
 */
function getNextArticleFromPool() {
    if (articlePool.length === 0) return null;

    const roll = Math.random();

    // 1. 18% Exploration Gate: Pure randomness to break structural echo chambers
    if (roll < 0.18) {
        const index = Math.floor(Math.random() * articlePool.length);
        return articlePool.splice(index, 1)[0];
    }

    // Calculate local user context scores for the entire current queue
    let scored = articlePool.map((art, index) => {
        let score = art.image ? 5 : 0; // Small systemic weight reward for visual items
        art.categories.forEach(cat => { score += (categoryScores[cat] || 0); });
        return { article: art, poolIndex: index, score: score };
    });

    // Sort candidates highest score to lowest
    scored.sort((a, b) => b.score - a.score);

    // 2. 42% Exploitation Gate: Target the absolute highest ranked match
    let targetIndex = scored[0].poolIndex;

    // 3. 40% Proportional Gate: Run a weighted roulette style selection wheel
    if (roll >= 0.60) {
        let minScore = Math.min(...scored.map(s => s.score));
        let offset = minScore < 0 ? Math.abs(minScore) + 1 : 0; // Shift scores above 0
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

    // Splice and extract the selected item from the array pool to guarantee zero duplicates
    return articlePool.splice(targetIndex, 1)[0];
}

// Global interest modifier map tracker
function updateScores(categories, points) {
    categories.forEach(cat => {
        categoryScores[cat] = (categoryScores[cat] || 0) + points;
    });
    console.log("Updated Local Core Interest Weights Matrix:", categoryScores);
}

/**
 * UI Render & DOM Manipulation Controller
 */
async function renderNextPost() {
    // Infinite Queue Hook: If user has consumed the pool down to 3 items, request background reinforcement
    if (articlePool.length <= 3) {
        console.log("Local item pool hitting threshold. Auto-fetching fresh live network content...");
        let freshBatch = await fetchLiveArticlesFromServer(10);
        articlePool = articlePool.concat(freshBatch);
    }

    const article = getNextArticleFromPool();
    if (!article) return;

    postsSinceLastLike++;

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = article.id;

    let imgTag = article.image ? `<img src="${article.image}" class="post-img" alt="wiki graphic">` : '';

    card.innerHTML = `
    <div class="title">${article.title}</div>
    <div class="text">${article.text}</div>
    ${imgTag}
    <div class="actions">
      <span class="like-btn">❤ Like</span>
    </div>
  `;

    // Action Listener: Open the real article in a secure, isolated new browser tab on card click
    card.addEventListener('click', (e) => {
        // Prevent standard tab redirection if they are clicking the like action text node
        if (e.target.classList.contains('like-btn')) {
            return;
        }

        const wikiUrl = `https://simple.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;
        window.open(wikiUrl, '_blank');

        // Give a massive +75 point reward for deep-dive navigation behavior
        updateScores(article.categories, 75);
    });

    // Action Listener: Like interaction button
    const likeBtn = card.querySelector('.like-btn');
    likeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Stop the click event from bubbling up to the card click listener
        likeBtn.classList.toggle('liked');

        // Dynamic streak score: Liking an item after scrolling far scales rewards higher
        let points = 50 + (4 * postsSinceLastLike);
        updateScores(article.categories, points);
        postsSinceLastLike = 0;
    });

    // Action Listener: Focus Image Click Bonus
    if (article.image) {
        card.querySelector('.post-img').addEventListener('click', (e) => {
            e.stopPropagation(); // Keep image interaction isolated
            updateScores(article.categories, 100);
            const wikiUrl = `https://simple.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;
            window.open(wikiUrl, '_blank');
        });
    }

    document.getElementById('feed').appendChild(card);
}

/**
 * Intersection Observer Engine
 * Monitors user viewport location to trigger endless rendering & content skipping penalties
 */
function setupIntersectionObserver() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            // If a card left the user view going upward without engagement, deduct points
            if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
                observer.unobserve(entry.target);
                renderNextPost();
            }
        });
    }, { threshold: 0.0 }); // Use 0.0 value for precise intersection calculation on remote pages

    // Periodically sweep DOM to register dynamic card objects into active intersection tracking
    setInterval(() => {
        document.querySelectorAll('.card').forEach(card => observer.observe(card));
    }, 1000);
}

// Initial Bootstrapper Engine
async function init() {
    console.log("Bootstrapping live algorithmic wiki platform core...");
    articlePool = await fetchLiveArticlesFromServer(10);

    // Render the original baseline 3 elements to screen
    for (let i = 0; i < 3; i++) {
        await renderNextPost();
    }
    setupIntersectionObserver();
}

window.onload = init;