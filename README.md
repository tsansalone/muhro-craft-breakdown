# MuhRO Craft Breakdown

A crafting material calculator for the **MuhRO** private Ragnarok Online server.  
Select any craftable item and get a full breakdown of every material needed — including sub-crafts, quantity deductions for items you already own, and a flat farming list of everything you still need to gather.

**Live:** https://tsansalone.github.io/muhro-craft-breakdown/

---

## What it does

- **Search** for any item in the database by name
- **Breakdown** — see the full recipe tree; expand sub-crafts as deep as you want
- **Have deductions** — enter how many of each material you already own; quantities propagate down the entire tree
- **Craft toggle** — mark an item as "buying/dropping instead of crafting"; it collapses that branch everywhere including the copy output. Items flagged as `droppable` in the database are always treated as leaves — no craft option shown
- **Copy list** — copies the full recipe tree (and a "Needed" section when you have deductions) to your clipboard in plain text, ready for Notepad
- **Farming List** — a flat summary at the bottom showing every raw material summed across all branches, sorted by ID with Zeny last
- **Item links** — every item name links to its page on the MuhRO item database

---

## Project structure

```
index.html          Main app (served via GitHub Pages)
editor.html         Item editor (not linked from the app, but accessible at /editor.html)
css/style.css       All styles — dark Ragnarok-inspired theme
js/app.js           All app logic
data/items.json     Item and recipe database
```

---

## Contributing — adding or editing items

Items live in `data/items.json`. The easiest way to edit it is through the built-in **Item Editor**.

### Opening the editor

The editor is hosted alongside the app — just open it directly:

**https://tsansalone.github.io/muhro-craft-breakdown/editor.html**

It loads the current `data/items.json` from the live site automatically. No local server or setup required.

---

### Using the editor

#### Browsing items
The left sidebar lists all items in the database. Use the search box to filter by name or ID. The **craft** / **raw** tag shows whether the item has a recipe.

#### Editing an existing item
Click any item in the sidebar. The editor form opens on the right with all its current fields pre-filled. Make your changes and click **Save changes**.

#### Adding a new item
Click **+ New** at the top of the sidebar. Fill in the fields:

| Field | Description |
|---|---|
| **ID** | Unique identifier. Use the in-game item ID (numeric, e.g. `1001996`) for real items. Must be unique — cannot be changed after saving. |
| **Name** | Display name shown in the app (e.g. `Chaotic Rune`). |
| **Type** | Toggle between **Craftable** (has a recipe) and **Raw material** (farmed/bought, no recipe). |
| **Droppable** | Enable if players typically obtain this item by farming or buying rather than crafting. When enabled, the item always appears as a leaf in the breakdown — no craft option is shown. |
| **Recipe** | Only shown when Craftable is on. Add one row per ingredient — pick the item from the dropdown and enter the quantity needed to craft **one** unit of this item. |

Click **Add item** to save.

#### Saving your changes
The editor never modifies any file on the server — it works entirely in your browser. When you're done, click **⬇ Download items.json** at the bottom of the page.

To submit your changes:
1. Fork the repository on GitHub
2. Replace `data/items.json` in your fork with the downloaded file
3. Open a Pull Request — that's it

---

### Editing `items.json` manually

If you prefer to edit the file directly, the schema is documented in the `_schema` block at the top of the file. Key rules:

- `id` must be unique and must match exactly when referenced in recipes (case-sensitive)
- Set `craftable: true` and provide a `recipe` array for items that can be crafted
- Set `craftable: false` and omit `recipe` for raw materials
- Set `droppable: true` on craftable items that players typically obtain as drops or purchases
- Zeny is just another item (`"id": "zeny"`) — add it to a recipe like any other ingredient

**Minimal examples:**

```json
{ "id": "1001234", "name": "My Raw Material", "craftable": false }

{ "id": "1001235", "name": "My Craftable Item", "craftable": true, "recipe": [
    { "itemId": "1001234", "qty": 5 },
    { "itemId": "zeny",    "qty": 100000 }
]}

{ "id": "1001236", "name": "Usually Dropped Item", "craftable": true, "droppable": true, "recipe": [
    { "itemId": "1001234", "qty": 3 }
]}
```

