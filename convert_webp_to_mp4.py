import os
from PIL import Image
import cv2
import numpy as np

def convert_webp_to_mp4(webp_path, mp4_path, fps=10):
    if not os.path.exists(webp_path):
        print(f"[ERROR] Source WebP file not found at: {webp_path}")
        return

    print(f"[CONVERTER] Opening WebP: {webp_path}")
    im = Image.open(webp_path)
    
    # Read frame dimensions
    width, height = im.size
    print(f"[CONVERTER] Frame resolution: {width}x{height}")
    
    # Initialize OpenCV VideoWriter using MP4V codec
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    video = cv2.VideoWriter(mp4_path, fourcc, fps, (width, height))
    
    frame_count = 0
    try:
        while True:
            # Convert frame to RGB, then to BGR (OpenCV format)
            frame_rgb = im.convert('RGB')
            frame_np = np.array(frame_rgb)
            frame_bgr = cv2.cvtColor(frame_np, cv2.COLOR_RGB2BGR)
            
            # Write frame to video
            video.write(frame_bgr)
            frame_count += 1
            
            # Seek to the next frame
            im.seek(im.tell() + 1)
    except EOFError:
        pass  # Reached end of animation
        
    video.release()
    print(f"[OK] Converted {frame_count} frames. MP4 successfully generated at: {mp4_path}")

if __name__ == "__main__":
    # Define source and destination paths
    webp_file = r"C:\Users\rajai\.gemini\antigravity-ide\brain\664c60f2-d40a-40ae-bfac-82fed7048853\parksense_demo_1781869094289.webp"
    mp4_file = r"C:\Users\rajai\.gemini\antigravity-ide\brain\664c60f2-d40a-40ae-bfac-82fed7048853\parksense_demo.mp4"
    
    convert_webp_to_mp4(webp_file, mp4_file)
