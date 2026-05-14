FROM node:20-alpine

# Install PHP for the MDK Kernel
RUN apk add --no-cache php83 php83-json php83-openssl php83-mbstring php83-tokenizer build-base && \
    ln -sf /usr/bin/php83 /usr/bin/php

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
