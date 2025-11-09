"""
Script to clean up unused HuggingFace model caches to free up disk space.
This will remove old models that are no longer used by the application.
"""

import os
import shutil
from pathlib import Path

# Models we NO LONGER need (can be deleted):
MODELS_TO_DELETE = [  # BART - Removed, using Gemini API instead
    "Salesforce--blip2-opt-2.7b",  # Old BLIP2 - Replaced with InstructBLIP
    "Salesforce--blip-image-captioning-base",  # Old BLIP - Not used
    "Salesforce--blip-image-captioning-large",  # Old BLIP - Not used
    "t5-base",  # T5 - Replaced with Pegasus
    "google--t5-v1_1-base",  # T5 variant - Not used
    "Salesforce--instructblip-flan-t5-xxl",  # Larger variant - keeping only XL
    "Salesforce--instructblip-vicuna-7b",  # Largest variant - keeping only XL
]

# Models we KEEP (currently in use):
MODELS_TO_KEEP = [
    "google--pegasus-xsum",  # Pegasus for video summarization
    "Salesforce--instructblip-flan-t5-xl",  # InstructBLIP for fallback image captioning
]

def get_cache_dir():
    """Get the HuggingFace cache directory"""
    cache_dir = os.path.expanduser("~/.cache/huggingface/hub")
    if os.name == 'nt':  # Windows
        cache_dir = os.path.expandvars(r"%USERPROFILE%\.cache\huggingface\hub")
    return cache_dir

def get_model_size(model_path):
    """Calculate total size of a model directory"""
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(model_path):
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            if os.path.exists(filepath):
                total_size += os.path.getsize(filepath)
    return total_size

def format_size(bytes_size):
    """Format bytes to human readable format"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.2f} TB"

def main():
    cache_dir = get_cache_dir()
    print(f"🔍 Checking HuggingFace cache: {cache_dir}")
    
    if not os.path.exists(cache_dir):
        print("✅ No cache directory found - nothing to clean!")
        return
    
    total_freed = 0
    models_deleted = 0
    
    print("\n📋 Scanning for models to delete...\n")
    
    # List all model directories
    for item in os.listdir(cache_dir):
        item_path = os.path.join(cache_dir, item)
        
        if not os.path.isdir(item_path):
            continue
        
        # Check if this model should be deleted
        should_delete = False
        for model_name in MODELS_TO_DELETE:
            if model_name in item:
                should_delete = True
                break
        
        if should_delete:
            model_size = get_model_size(item_path)
            print(f"🗑️  Deleting: {item}")
            print(f"   Size: {format_size(model_size)}")
            
            try:
                shutil.rmtree(item_path)
                total_freed += model_size
                models_deleted += 1
                print(f"   ✅ Deleted successfully!")
            except Exception as e:
                print(f"   ❌ Error deleting: {e}")
            print()
    
    print("\n" + "="*60)
    print(f"✅ Cleanup complete!")
    print(f"   Models deleted: {models_deleted}")
    print(f"   Space freed: {format_size(total_freed)}")
    print("="*60)
    
    print("\n📦 Models currently in use:")
    for model in MODELS_TO_KEEP:
        print(f"   ✓ {model}")
    
    print("\n💡 Note: Models will be re-downloaded if needed by the application.")
    print("   The current setup uses:")
    print("   • Gemini API (cloud) - Text summarization & primary image captioning")
    print("   • InstructBLIP-FlanT5-XL (~5GB) - Fallback image captioning")
    print("   • Pegasus-XSUM (~2GB) - Video summarization")

if __name__ == "__main__":
    print("="*60)
    print("HuggingFace Model Cache Cleanup")
    print("="*60)
    print("\nThis script will delete old/unused models to free up space.")
    print("Models currently in use will NOT be deleted.\n")
    
    response = input("Do you want to proceed? (yes/no): ").strip().lower()
    
    if response in ['yes', 'y']:
        main()
    else:
        print("\n❌ Cleanup cancelled.")
