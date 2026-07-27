const cloudinary = require('cloudinary').v2;

// Reads CLOUDINARY_URL (or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET) from env automatically.
module.exports = cloudinary;
