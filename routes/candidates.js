const router = require('express').Router();
// TODO: Implement candidates routes
router.get('/', (req, res) => res.json({ success: true, data: [] }));
router.post('/', (req, res) => res.json({ success: true, message: 'candidates route placeholder' }));
module.exports = router;
