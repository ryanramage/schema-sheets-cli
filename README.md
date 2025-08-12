# Schema Sheets CLI

A peer-to-peer multiwriter room system for collaborative schema-based data entry. Create or join rooms to share and manage structured JSON data with real-time synchronization across all participants.
## Usage

Start the application:

```bash
npx schema-sheets-cli
```

## Features

### Room Management
- **Create New Rooms**: Generate a new collaborative space with a shareable room link
- **Join by Link**: Connect to existing rooms using invitation links
- **Room Persistence**: Previously joined rooms are remembered for easy re-access
- **User Identity**: Each participant joins with a username for identification

### Schema Management
- **Add Schemas**: Import JSON Schema files to define data structure
- **Multiple Schemas**: Each room can contain multiple different schemas
- **Schema Validation**: All data entries are validated against their respective schemas using AJV

### Data Entry & Management
- **Add Rows**: Import JSON data files that conform to your schemas
- **Web Form**: Add rows with a temp web app that uses your schema to create a form
- **List All Rows**: View all entries in a schema with tabular summaries
- **Filter by Date**: Built-in date range filtering (today, yesterday, this week, last week, this month, last month, custom ranges)
- **JMESPath Queries**: Advanced filtering using JMESPath expressions for complex data queries
- **JSON Validation**: Automatic validation ensures data integrity

### Data Viewing
- **Interactive JSON Viewer**: Enhanced JSON viewing with `fx` (if installed)
- **Fallback Display**: Plain JSON output when `fx` is not available
- **Row Details**: Full JSON inspection for individual entries
- **Table Summaries**: Compact tabular view of multiple rows

## Installation

### Optional Dependencies

For enhanced JSON viewing, install `fx`:

```bash
brew install fx
```
For other systems see the [fx install](https://fx.wtf/install)


When `fx` is available, you'll get an interactive, collapsible JSON viewer for examining row details. Without `fx`, the system falls back to plain JSON display.


### Creating and Sharing Rooms

1. **Create a Room**:
   - Select "🆕 Create New Room" from the lobby
   - Enter a room name (this helps identify the room)
   - Enter your username
   - You'll receive a room link that others can use to join

2. **Share the Room**:
   - Copy the room link from the creation process
   - Or use "📋 Copy Room Link" from within the room to copy it to clipboard
   - Share this link with collaborators

3. **Room Link Format**:
   - Links are safe to share via any communication method

### Joining Rooms

1. **Join by Link**:
   - Select "🔗 Join Room by Link" from the lobby
   - Paste the room link you received
   - Enter your username
   - You'll be connected to the shared room

2. **Rejoin Known Rooms**:
   - Previously joined rooms appear in the lobby
   - Click on any known room to rejoin with your previous username
   - Rooms show creation date and your role (👑 creator or 👤 member)

### Working with Schemas

1. **Add a Schema**:
   - Use "➕ Add Schema" from the main room menu
   - Select a JSON Schema file from your filesystem
   - Give the schema a descriptive name

2. **Manage Schema Data**:
   - Select any schema from the main menu
   - Choose from: List Rows, Filter Rows, or Add Row
   - All operations are synchronized across all room participants

### Data Operations

1. **Adding Data**:
   - Select "➕ Add Row" from a schema menu
   - Choose a JSON file containing data
   - The system validates the data against the schema
   - Valid data is added and synchronized to all participants

2. **Viewing Data**:
   - "📋 List Rows" shows all entries in a table format
   - Click any row to view full JSON details
   - Use `fx` for interactive exploration (if installed)

3. **Filtering Data**:
   - "🔍 Filter Rows" provides date-based filtering
   - Choose from preset ranges or set custom dates
   - Optionally add JMESPath queries for advanced filtering
   - Results are displayed in the same table format

## Technical Details

- **P2P Architecture**: Uses Hyperswarm for peer discovery and connection
- **Data Storage**: Built on Corestore and Autobase for distributed data
- **Encryption**: All room data is encrypted using the room's encryption key
- **Schema Validation**: Uses AJV with format support for robust validation
- **Cross-Platform**: Works on macOS, Linux, and Windows

## Configuration and Data Storage

### Data Directories

Schema Sheets CLI stores its data in platform-appropriate directories using the `env-paths` standard:

- **macOS**: `~/Library/Application Support/schema-sheets/`
- **Linux**: `~/.local/share/schema-sheets/`
- **Windows**: `%APPDATA%\schema-sheets\`

### Directory Structure

```
schema-sheets/
├── config.json          # Configuration file
├── rooms/               # Room metadata storage
│   ├── abc123...json    # Individual room files (named by key hex)
│   └── def456...json
└── corestore/           # Hypercore data storage
    ├── cores/           # Individual hypercore files
    └── ...
```

### Configuration File

The optional `config.json` file allows you to customize application behavior:

```json
{
  "DEFAULT_BLIND_PEER_KEYS": [
    "4c39nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "ep4bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "narayxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  ]
}
```

#### Configuration Options

- **`DEFAULT_BLIND_PEER_KEYS`**: Array of z32-encoded public keys for blind peering servers that help with peer discovery. These servers act as relay points to help peers find each other when direct connections aren't possible.

### Room Storage

Each room you create or join is stored locally in the `rooms/` directory:

- Room files are named using the hex representation of the room key
- Contains room metadata: name, creation date, your username, creator status
- Encryption keys are stored locally for rejoining rooms
- Room data (schemas and rows) is stored in the distributed Hypercore system

### Data Persistence

- **Local Storage**: Room metadata and configuration persist locally for easy rejoining
- **Distributed Storage**: All schema and row data is synchronized across peers in real-time using Hypercore
- **Encryption**: All room data is encrypted using the room's encryption key
- **Offline Access**: Previously synced data remains available when offline

## Room Security

- Each room has unique encryption keys
- Room links contain both access and encryption information
- Only participants with the room link can join and access data
- All data transmission is encrypted end-to-end
