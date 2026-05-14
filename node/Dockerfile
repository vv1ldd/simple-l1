FROM node:20-alpine

# Install PHP for the MDK Kernel
RUN apk add --no-cache php82 php82-json php82-openssl php82-mbstring php82-tokenizer

WORKDIR /app

COPY package*.json ./
RUN npm install

# Copy kernel source (now local to node folder)
COPY kernel ./kernel
COPY . .

# We assume MDK Kernel is copied into the /app/kernel directory during build
# For local dev, we will mount it via docker-compose

EXPOSE 3000

CMD ["npm", "start"]
