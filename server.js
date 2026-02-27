require("dotenv").config();
const express = require("express");
const cors = require("cors");
const propertyRoutes = require("./Routes/PropertyRoutes");
const bookingRoutes = require("./Routes/bookingRoutes");
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./Routes/AuthRoutes"));
app.use("/api/admin", require("./Routes/AdminRoutes"));
<<<<<<< HEAD
app.use("/api/properties", propertyRoutes);
app.use("/uploads", express.static("uploads"));
app.use("/api/bookings", bookingRoutes);
=======
app.use("/api/categories",require("./Routes/CategoryRoutes" ));

>>>>>>> fbdc65ea04955f163d2cc3c2793081b801d6bdae
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});