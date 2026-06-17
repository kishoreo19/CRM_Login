const router = require('express').Router();
// TODO: Implement jobs routes
router.get('/', (req, res) => res.json({ success: true, data: [] }));
router.post('/', (req, res) => res.json({ success: true, message: 'jobs route placeholder' }));
module.exports = router;
