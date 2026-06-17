const router = require('express').Router();
// TODO: Implement contact routes
router.get('/', (req, res) => res.json({ success: true, data: [] }));
router.post('/', (req, res) => res.json({ success: true, message: 'contact route placeholder' }));
module.exports = router;
