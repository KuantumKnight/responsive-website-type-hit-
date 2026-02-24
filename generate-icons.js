const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');

// Create a simple blue square with white "EQ" text an icon
const svgImage = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#2563eb" rx="100" />
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="250" font-weight="bold" fill="white" dominant-baseline="middle" text-anchor="middle">EQ</text>
</svg>
`;

async function generateIcons() {
    try {
        const buffer = Buffer.from(svgImage);

        // Generate 192x192
        await sharp(buffer)
            .resize(192, 192)
            .toFile(path.join(publicDir, 'icon-192x192.png'));

        // Generate 512x512
        await sharp(buffer)
            .resize(512, 512)
            .toFile(path.join(publicDir, 'icon-512x512.png'));

        console.log('Successfully generated PWA icons.');
    } catch (error) {
        console.error('Error generating icons:', error);
    }
}

generateIcons();
