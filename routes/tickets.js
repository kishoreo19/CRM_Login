const router = require('express').Router();
// TODO: Implement tickets routes
router.get('/', (req, res) => res.json({ success: true, data: [] }));
router.post('/', (req, res) => res.json({ success: true, message: 'tickets route placeholder' }));
module.exports = router;
