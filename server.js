const express = require('express');
const multer = require('multer');
const mysql = require('mysql2');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static('uploads'));


// MySQL Connection
const db = mysql.createConnection({
  host: '162.214.98.236',
  user: 'citforgl_citf_user',
  password: 'citfUser@1230#', // Update your password here
  database: 'citforgl_citf_admin_panel',
});

db.connect((err) => {
  if (err) throw err;
  console.log('✅ MySQL connected');
});

// Multer Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// Helper: Delete files by image URLs array
function deleteFiles(imageUrls) {
  imageUrls.forEach((imgUrl) => {
    const filepath = path.join(__dirname, imgUrl);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  });
}

// === Projects ===

// GET all projects with their images
app.get('/api/projects', (req, res) => {
  // Join projects with images
  const sql = `
    SELECT p.id, p.title, p.description, pi.image_url
    FROM projects p
    LEFT JOIN project_images pi ON p.id = pi.project_id
    ORDER BY p.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching projects:', err);
      return res.status(500).json({ message: 'Failed to fetch projects', error: err });
    }

    // Group images by project
    const projectsMap = new Map();
    results.forEach(({ id, title, description, image_url }) => {
      if (!projectsMap.has(id)) {
        projectsMap.set(id, { id, title, description, images: [] });
      }
      if (image_url) {
  const fullUrl = `${req.protocol}://${req.get('host')}${image_url}`;
  projectsMap.get(id).images.push(fullUrl);
}

    });

    const projects = Array.from(projectsMap.values());
    res.json(projects);
  });
});

// GET single project by id (with images)
app.get('/api/projects/:id', (req, res) => {
  const projectId = req.params.id;
  const sql = `
    SELECT p.id, p.title, p.description, pi.image_url
    FROM projects p
    LEFT JOIN project_images pi ON p.id = pi.project_id
    WHERE p.id = ?
  `;

  db.query(sql, [projectId], (err, results) => {
    if (err) {
      console.error('Error fetching project:', err);
      return res.status(500).json({ message: 'Failed to fetch project', error: err });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = {
      id: results[0].id,
      title: results[0].title,
      description: results[0].description,
      images: [],
    };

    results.forEach(({ image_url }) => {
      if (image_url) project.images.push(image_url);
    });

    res.json(project);
  });
});

// POST add project with images (up to 5)
app.post('/api/projects', upload.array('images', 5), (req, res) => {
  const { title, description } = req.body;
  const images = req.files;

  if (!title || !description) {
    return res.status(400).json({ message: 'Title and Description are required' });
  }

  const sqlProject = 'INSERT INTO projects (title, description) VALUES (?, ?)';
  db.query(sqlProject, [title, description], (err, result) => {
    if (err) {
      console.error('Error inserting project:', err);
      return res.status(500).json({ message: 'Error inserting project', error: err });
    }

    const projectId = result.insertId;

    if (!images || images.length === 0) {
      return res.status(201).json({ message: 'Project saved without images', projectId });
    }

    const sqlImages = 'INSERT INTO project_images (project_id, image_url) VALUES ?';
    const imageValues = images.map((img) => [projectId, `/uploads/${img.filename}`]);

    db.query(sqlImages, [imageValues], (err2) => {
      if (err2) {
        console.error('Error saving images:', err2);
        return res.status(500).json({ message: 'Project saved but failed to save images', error: err2 });
      }

      res.status(201).json({ message: 'Project and images saved successfully', projectId });
    });
  });
});

// PUT update project and optionally images by id
app.put('/api/projects/:id', upload.array('images', 5), (req, res) => {
  const projectId = req.params.id;
  const { title, description } = req.body;
  const images = req.files;

  if (!title || !description) {
    return res.status(400).json({ message: 'Title and Description are required' });
  }

  // Update title and description
  const sqlUpdate = 'UPDATE projects SET title = ?, description = ? WHERE id = ?';
  db.query(sqlUpdate, [title, description, projectId], (err) => {
    if (err) {
      console.error('Error updating project:', err);
      return res.status(500).json({ message: 'Error updating project', error: err });
    }

    if (!images || images.length === 0) {
      // No new images, done
      return res.status(200).json({ message: 'Project updated successfully (images unchanged)' });
    }

    // Delete old images from disk and DB
    const sqlSelectImages = 'SELECT image_url FROM project_images WHERE project_id = ?';
    db.query(sqlSelectImages, [projectId], (err2, oldImages) => {
      if (err2) {
        console.error('Error fetching old images:', err2);
        return res.status(500).json({ message: 'Error fetching old images', error: err2 });
      }

      // Delete files from disk
      const oldImageUrls = oldImages.map((row) => row.image_url);
      deleteFiles(oldImageUrls);

      // Delete from DB
      const sqlDeleteImages = 'DELETE FROM project_images WHERE project_id = ?';
      db.query(sqlDeleteImages, [projectId], (err3) => {
        if (err3) {
          console.error('Error deleting old images:', err3);
          return res.status(500).json({ message: 'Error deleting old images', error: err3 });
        }

        // Insert new images
        const sqlInsertImages = 'INSERT INTO project_images (project_id, image_url) VALUES ?';
        const imageValues = images.map((img) => [projectId, `/uploads/${img.filename}`]);
        db.query(sqlInsertImages, [imageValues], (err4) => {
          if (err4) {
            console.error('Error inserting new images:', err4);
            return res.status(500).json({ message: 'Error inserting new images', error: err4 });
          }

          res.status(200).json({ message: 'Project and images updated successfully' });
        });
      });
    });
  });
});

// DELETE project and its images by id
app.delete('/api/projects/:id', (req, res) => {
  const projectId = req.params.id;

  // First get all image URLs to delete files from uploads folder
  const sqlSelectImages = 'SELECT image_url FROM project_images WHERE project_id = ?';
  db.query(sqlSelectImages, [projectId], (err, images) => {
    if (err) {
      console.error('Error fetching project images:', err);
      return res.status(500).json({ message: 'Error fetching project images', error: err });
    }

    // Delete files from uploads folder
    const imageUrls = images.map(row => row.image_url);
    deleteFiles(imageUrls);

    // Delete images from DB
    const sqlDeleteImages = 'DELETE FROM project_images WHERE project_id = ?';
    db.query(sqlDeleteImages, [projectId], (err2) => {
      if (err2) {
        console.error('Error deleting project images:', err2);
        return res.status(500).json({ message: 'Error deleting project images', error: err2 });
      }

      // Delete project itself
      const sqlDeleteProject = 'DELETE FROM projects WHERE id = ?';
      db.query(sqlDeleteProject, [projectId], (err3) => {
        if (err3) {
          console.error('Error deleting project:', err3);
          return res.status(500).json({ message: 'Error deleting project', error: err3 });
        }

        res.status(200).json({ message: 'Project and images deleted successfully' });
      });
    });
  });
});


// === Scroll Images ===

// Add scroll images (unlimited)
app.post('/api/scroll-images', upload.array('images'), (req, res) => {
  const images = req.files;

  if (!images || images.length === 0) {
    return res.status(400).json({ message: 'No images uploaded' });
  }

  const sql = 'INSERT INTO scroll_images (image_url) VALUES ?';
  const imageValues = images.map((img) => [`/uploads/${img.filename}`]);

  db.query(sql, [imageValues], (err) => {
    if (err) return res.status(500).json({ message: 'Error saving scroll images', error: err });

    res.status(200).json({ message: 'Scroll images uploaded successfully' });
  });
});

// Delete scroll image by id
app.delete('/api/scroll-images/:id', (req, res) => {
  const imageId = req.params.id;

  // Get image URL to delete file
  const sqlSelect = 'SELECT image_url FROM scroll_images WHERE id = ?';
  db.query(sqlSelect, [imageId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching scroll image', error: err });
    if (results.length === 0) return res.status(404).json({ message: 'Scroll image not found' });

    const imageUrl = results[0].image_url;
    const filepath = path.join(__dirname, imageUrl);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    // Delete from DB
    const sqlDelete = 'DELETE FROM scroll_images WHERE id = ?';
    db.query(sqlDelete, [imageId], (err2) => {
      if (err2) return res.status(500).json({ message: 'Error deleting scroll image', error: err2 });

      res.status(200).json({ message: 'Scroll image deleted successfully' });
    });
  });
});
// GET all scroll images
app.get('/api/scroll-images', (req, res) => {
  const sql = 'SELECT id, image_url FROM scroll_images ORDER BY id DESC';

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching scroll images:', err);
      return res.status(500).json({ message: 'Failed to fetch scroll images', error: err });
    }

    res.json(results);
  });
});



// === Videos ===

// Add video URL
app.post('/api/videos', (req, res) => {
  const { video_url } = req.body;

  if (!video_url || video_url.trim() === '') {
    return res.status(400).json({ message: 'Video URL is required' });
  }

  const sql = 'INSERT INTO videos (video_url) VALUES (?)';

  db.query(sql, [video_url.trim()], (err, result) => {
    if (err) return res.status(500).json({ message: 'Error inserting video URL', error: err });

    res.status(200).json({ message: 'Video URL added successfully', videoId: result.insertId });
  });
});

// Delete video by id
app.delete('/api/videos/:id', (req, res) => {
  const videoId = req.params.id;

  const sql = 'DELETE FROM videos WHERE id = ?';
  db.query(sql, [videoId], (err, result) => {
    if (err) return res.status(500).json({ message: 'Error deleting video', error: err });

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.status(200).json({ message: 'Video deleted successfully' });
  });
});
// GET all videos (with `url` key and embedded YouTube link)
app.get('/api/videos', (req, res) => {
  const sql = 'SELECT id, video_url FROM videos ORDER BY id DESC';
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching videos', error: err });
    }

    const formatted = results.map(video => {
      let embedUrl = video.video_url;

      // Convert YouTube normal link to embed format if it's a YouTube watch URL
      const match = embedUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
      if (match) {
        const videoId = match[1];
        embedUrl = `https://www.youtube.com/embed/${videoId}`;
      }

      return {
        id: video.id,
        url: embedUrl,
        title: 'Watch Video'
      };
    });

    res.json(formatted);
  });
});




// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
