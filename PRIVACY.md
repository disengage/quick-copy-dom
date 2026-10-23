# Privacy Policy for Quick Copy DOM

**Last updated: October 2026**

## Overview

Quick Copy DOM is committed to protecting your privacy. This privacy policy explains what information (if any) our extension collects and how it's used.

## Data Collection

**Quick Copy DOM does not collect or transmit personal data or page content.**

Specifically, we do NOT:
- Collect personal information
- Track your browsing history
- Send any information to external servers
- Use analytics or tracking tools
- Access page content except when you activate selection or preview a CSS selector in the popup

The extension stores two settings locally in Chrome's extension storage: the most recently selected CSS selector and whether HTML downloads are enabled. These settings are used to restore the popup state and support Quick Selecting. You can remove the saved selector from the popup. The extension does not store copied HTML or a history of selected elements.

## How the Extension Works

Quick Copy DOM operates entirely within your browser:

1. When you activate the extension (by clicking the icon or using the keyboard shortcut), or preview a CSS selector in the popup, it injects a small script into the current page
2. The script highlights elements as you hover over them or preview a matching saved selector
3. When you select an element, its HTML is copied to your local clipboard
4. If **Download HTML when selection** is enabled, the extension sends the selected HTML to Chrome's downloads API to show a save dialog and save an `.html` file at the location you choose. Quick Selecting also copies the HTML and can download it when this option is enabled.
5. No page content or settings are sent to an external service

## Permissions Explained

| Permission | Why We Need It |
|------------|----------------|
| `activeTab` | To interact with the current page when you activate the extension. This permission only grants access to the tab you're actively using. |
| `scripting` | To inject the element selection functionality when activated or to preview a CSS selector from the popup. |
| `downloads` | To open Chrome's save dialog and download selected HTML when you enable the download option. |
| `storage` | To save the last selected CSS selector and download preference in Chrome's local extension storage. |

## Third-Party Services

Quick Copy DOM does not use any third-party services, APIs, or analytics.

## Data Storage

The selected HTML is processed in memory and copied to your local clipboard. It is not written to extension storage. The CSS selector and download preference persist in Chrome's local extension storage until removed or the extension's data is cleared. If you choose to download HTML, Chrome saves the file to the location you select; that file is managed by Chrome and remains on your device.

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date at the top of this document.

## Contact

If you have questions about this privacy policy, please open an issue on our GitHub repository.

## Summary

Quick Copy DOM is a local-only tool: it does not track browsing, collect personal data, or communicate with external services. It stores only the selector and download preference needed for its features, and does not store selected page HTML.
