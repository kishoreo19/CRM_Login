const router = require('express').Router();
// TODO: Implement uploads routes
router.get('/', (req, res) => res.json({ success: true, data: [] }));
router.post('/', (req, res) => res.json({ success: true, message: 'uploads route placeholder' }));
module.exports = router;
