'use strict';

const express = require('express');
const router  = express.Router();
const { listJobs, getJob } = require('../services/jobQueue');

// GET /jobs
router.get('/jobs', (_req, res) => {
  res.json({ jobs: listJobs().map(j => ({
    id:         j.id,
    module:     j.module,
    status:     j.status,
    startedAt:  j.startedAt,
    finishedAt: j.finishedAt,
    createdAt:  j.createdAt,
    stepsCount: j.steps.length,
    error:      j.error,
  })) });
});

// GET /jobs/:id
router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
  res.json({
    id:         job.id,
    module:     job.module,
    status:     job.status,
    steps:      job.steps,
    error:      job.error,
    startedAt:  job.startedAt,
    finishedAt: job.finishedAt,
    createdAt:  job.createdAt,
  });
});

module.exports = router;
