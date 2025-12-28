const fs = require('fs');
const path = require('path');

const CARDS_PATH = path.resolve(__dirname, 'cards.json');

let cards = [];

function loadFromFile() {
  if (!fs.existsSync(CARDS_PATH)) {
    cards = [];
    return cards;
  }
  try {
    const data = JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8'));
    if (Array.isArray(data)) {
      // Normalize entries (trim strings and normalize rarity to uppercase)
      cards = data.map(c => {
        try {
          if (c && c.id) c.id = String(c.id).trim();
          if (c && c.name) c.name = String(c.name).trim();
          if (c && c.group) c.group = String(c.group).trim();
          if (c && c.image_url) c.image_url = String(c.image_url).trim();
          if (c && c.rarity) c.rarity = String(c.rarity).trim().toUpperCase();
        } catch (e) {
          // ignore normalization errors per entry
        }
        return c;
      });
    } else cards = [];
  } catch (err) {
    console.error('[cardsStore] failed to read cards.json:', err.message);
    cards = [];
  }
  return cards;
}

function getCards() {
  return cards;
}

function setCards(newCards, persist = false) {
  if (!Array.isArray(newCards)) return false;
  // Normalize incoming cards similarly to loadFromFile
  cards = newCards.map(c => {
    try {
      if (c && c.id) c.id = String(c.id).trim();
      if (c && c.name) c.name = String(c.name).trim();
      if (c && c.group) c.group = String(c.group).trim();
      if (c && c.image_url) c.image_url = String(c.image_url).trim();
      if (c && c.rarity) c.rarity = String(c.rarity).trim().toUpperCase();
    } catch (e) {
      // ignore
    }
    return c;
  });
  if (persist) {
    try {
      fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2), 'utf8');
      console.log('[cardsStore] cards.json updated');
    } catch (err) {
      console.error('[cardsStore] failed to write cards.json:', err.message);
    }
  }
  return true;
}

// initial load
loadFromFile();

module.exports = { getCards, setCards, loadFromFile };
