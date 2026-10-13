# CustomLayout

A [Vencord](https://github.com/Vendicated/Vencord) userplugin that turns the Discord window into a dockable layout. While you are in a server, the server list, channel list, user panel, channel header, chat and member list become panels you can move, split and resize. Direct messages keep Discord's own layout.

## Tech stack

- TypeScript and React, built with Vencord's esbuild setup
- Vencord's plugin APIs: webpack patches, settings, context menus
- Plain CSS, no extra dependencies

## Features

- **Drag and drop editor** – drop a panel on any edge of another panel, or on an edge of the whole layout, to split that side.
- **Resizing** – drag the space between two panels, in or out of the editor.
- **Extra chat panels** – open any DM, group DM or channel next to the chat you are in.
- **Profiles** – save several layouts, switch between them, and pin one to a server.
- **Orientation aware panels** – the server list becomes a row when it lies flat, and the member list becomes one scrollable column per role.
- **Theme friendly** – uses the theme's own panel spacing and styling where it can.

## Usage

Clone this repository into `src/userplugins/customLayout` of a Vencord checkout, build Vencord and enable **CustomLayout** in the plugin settings.

Open the editor with `Ctrl+Shift+L` (can be changed in the plugin settings), from the Vencord Toolbox, or by right clicking a server and choosing **Edit Layout**. To add a chat panel, right click a user, channel or thread and choose **Open in Layout Panel**.

## License

[GPL-3.0-or-later](LICENSE). You may use, modify and fork this plugin, but copies and forks have to stay under the same license, keep the copyright notices and credit the original author. You may not present it as your own work.
