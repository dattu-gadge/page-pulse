const parseHTML = require("./parser");
const express = require("express");
const cors = require("cors");
const axios = require("axios");


const app = express();

app.use(cors());
app.use(express.json());

app.post("/analyze", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    const start = Date.now();

    const response = await axios.get(url);

    const end = Date.now();

   const result = parseHTML(response.data);

    
    res.json({
      status: response.status,
      responseTime: end - start,
      ...result,
    });
  }
  catch (error) {
    console.log(error);

    res.status(500).json({
      error: error.message ,
    });
  }
});

app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});