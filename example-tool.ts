#!/usr/bin/env bun
// Example tool demonstrating how to use gitproc with max parallelism constraints

import { acquireForTool, releaseCheckout, type ParallelToolOptions } from "./index";

async function runParallelTasks() {
  const options: ParallelToolOptions = {
    maxParallelism: 3, // Limit to 3 concurrent checkouts
    repo: "https://github.com/example/repo.git" // Optional, can be inferred from current dir
  };

  try {
    console.log("Acquiring checkout with max parallelism of 3...");
    const result = await acquireForTool(options);
    
    console.log(`Got checkout: ${result.directory}`);
    console.log(`Checkout ID: ${result.id}`);
    
    // Simulate some work
    console.log("Doing some work...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Release the checkout when done
    await releaseCheckout(result.id);
    console.log("Released checkout");
    
  } catch (error) {
    console.error("Error:", (error as Error).message);
  }
}

if (import.meta.main) {
  runParallelTasks();
}